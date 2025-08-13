
import { getState } from '../core/state.js';
import { updateLog } from '../core/utils.js';
import { renderAll } from '../ui/ui-renderer.js';
import { playCard } from '../game-logic/player-actions.js';
import { tryToSpeak, triggerNecroX } from '../story/story-abilities.js';
import { playSoundEffect, announceEffect } from '../core/sound.js';

/**
 * Executes a full turn for an AI player with enhanced strategic logic.
 * The AI will play at most one value card and consider playing one effect card per turn.
 * @param {object} player - The AI player object.
 */
export async function executeAiTurn(player) {
    const { gameState } = getState();
    gameState.gamePhase = 'paused';
    renderAll(); // Update UI to show AI is thinking
    await tryToSpeak(player);
    await new Promise(res => setTimeout(res, 1200));

    let playedACard = false;
    let specialAbilityUsed = false;

    try {
        // --- Part 1: Play a value card if necessary ---
        const valueCards = player.hand.filter(c => c.type === 'value');
        if (valueCards.length > 1 && !player.playedValueCardThisTurn) {
            const otherScores = gameState.playerIdsInGame
                .filter(id => id !== player.id && !gameState.players[id].isEliminated)
                .map(id => gameState.players[id].liveScore || 0);
            
            const maxOtherScore = otherScores.length > 0 ? Math.max(...otherScores) : -Infinity;
            const sortedValueCards = [...valueCards].sort((a, b) => a.value - b.value);
            let cardToPlay;

            // AI logic for which value card to play
            if (player.aiType === 'necroverso_final' || player.aiType === 'reversum') {
                cardToPlay = sortedValueCards[sortedValueCards.length - 1]; // Always play highest value card
            } else {
                const potentialWinCard = sortedValueCards[sortedValueCards.length - 1];
                const currentScoreWithResto = player.liveScore + (player.resto?.value || 0);
                
                if ((currentScoreWithResto + potentialWinCard.value) > maxOtherScore) {
                    cardToPlay = potentialWinCard; // Play high to win
                } else {
                    cardToPlay = sortedValueCards[0]; // Play low to save good cards
                }
            }
            
            updateLog(`AI ${player.name}: Jogando a carta de valor ${cardToPlay.name}.`);
            await playCard(player, cardToPlay, player.id);
            await new Promise(res => setTimeout(res, 800));
            playedACard = true;
        }

        // --- Part 2: Consider playing one effect card ---
        const effectCards = player.hand.filter(c => c.type === 'effect');
        let bestMove = { score: -1 };
        
        // --- AI PERSONALITY LOGIC ---
        if (player.aiType === 'versatrix' && gameState.currentStoryBattle === 'necroverso_final') {
             // ALLY LOGIC
            const player1 = gameState.players['player-1'];
            const necroTeamIds = ['player-2', 'player-3'];
            const opponents = necroTeamIds.map(id => gameState.players[id]).filter(p => p && !p.isEliminated);
            const leader = opponents.length > 0 ? [...opponents].sort((a,b) => b.liveScore - a.liveScore)[0] : null;

            for (const card of effectCards) {
                // Help player 1
                if (['Mais', 'Sobe'].includes(card.name) && player1.effects.score !== 'Mais' && 50 > bestMove.score) {
                    bestMove = { card, target: player1.id, score: 50, reason: "para ajudar seu aliado" };
                }
                // Attack opponents
                if (['Menos', 'Desce'].includes(card.name) && leader && leader.effects.score !== 'Menos' && 40 > bestMove.score) {
                    bestMove = { card, target: leader.id, score: 40, reason: "para atacar o inimigo" };
                }
            }
        } else if (player.aiType === 'reversum') {
            const player1 = gameState.players['player-1'];
            const opponents = Object.values(gameState.players).filter(p => p.id !== player.id && !p.isEliminated);
            const leader = opponents.length > 0 ? [...opponents].sort((a, b) => b.liveScore - a.liveScore)[0] : null;
            // Highest Priority: Use Reversus Total ability if conditions are met.
            if (!gameState.reversumAbilityUsedThisRound && player1.position >= 5 && player1.position < 10) {
                const selfHasNegativeEffect = player.effects.score === 'Menos' || player.effects.movement === 'Desce';
                const player1HasPositiveEffect = player1.effects.score === 'Mais' || player1.effects.movement === 'Sobe';
        
                if (selfHasNegativeEffect || player1HasPositiveEffect) {
                    const reason = selfHasNegativeEffect ? "para reverter um efeito negativo sobre si mesmo" : "para sabotar a vantagem do jogador";
                    const reversusTotalAbilityCard = { id: 'ability_reversus_total', name: 'Reversus Total', type: 'effect' };
                    bestMove = { card: reversusTotalAbilityCard, target: player.id, score: 100, reason, isReversumAbility: true };
                }
            }
            if (bestMove.score < 100) {
                 for (const card of effectCards) {
                     if (['Menos', 'Desce'].includes(card.name) && leader) {
                        if (50 > bestMove.score) bestMove = { card, target: leader.id, score: 50, reason: "para atacar o líder" };
                    } else if (['Mais', 'Sobe'].includes(card.name)) {
                         if (40 > bestMove.score) bestMove = { card, target: player.id, score: 40, reason: "para se fortalecer" };
                    } else if (card.name === 'Reversus' && leader && (leader.effects.score === 'Mais' || leader.effects.movement === 'Sobe')) {
                        const effectType = leader.effects.score === 'Mais' ? 'score' : 'movement';
                         if (60 > bestMove.score) bestMove = { card, target: leader.id, effectType, score: 60, reason: "para anular a vantagem do líder" };
                    }
                }
            }
        } else if (player.aiType === 'necroverso_final') {
            // Highest priority: Use NECRO X ability once per round with 20% chance
            if (!gameState.necroXUsedThisRound && Math.random() < 0.2) {
                await triggerNecroX(player);
                specialAbilityUsed = true;
            }

            const teamA_Ids = ['player-1', 'player-4']; // Player and Versatrix
            const teamB_Ids = ['player-2', 'player-3']; // Necroverso team
            const partnerId = teamB_Ids.find(id => id !== player.id);
            const partner = partnerId ? gameState.players[partnerId] : null;
            const opponentPlayers = teamA_Ids.map(id => gameState.players[id]).filter(p => p && !p.isEliminated);
            const leadingOpponent = opponentPlayers.length > 0 ? [...opponentPlayers].sort((a, b) => b.liveScore - a.liveScore)[0] : null;
            
            for (const card of effectCards) {
                if (['Menos', 'Desce'].includes(card.name) && leadingOpponent && 50 > bestMove.score) {
                    bestMove = { card, target: leadingOpponent.id, score: 50, reason: "para destruir o inimigo" };
                } else if (['Mais', 'Sobe'].includes(card.name) && partner && 30 > bestMove.score) {
                    const targetForHelp = player.liveScore < partner.liveScore ? player : partner;
                    bestMove = { card, target: targetForHelp.id, score: 30, reason: "para fortalecer a escuridão" };
                }
            }
        } else if (player.aiType === 'inversus') {
            const leader = Object.values(gameState.players).filter(p => p.id !== player.id && !p.isEliminated).sort((a, b) => b.liveScore - a.liveScore)[0] || null;
            
            const specialAbilityChance = Math.random();
            if (specialAbilityChance < 0.15 && !gameState.reversusTotalActive) {
                const reversusTotalAbilityCard = { id: 'ability_reversus_total', name: 'Reversus Total', type: 'effect' };
                await playCard(player, reversusTotalAbilityCard, player.id, null, { isGlobal: true });
                specialAbilityUsed = true;
            } else if (specialAbilityChance < 0.30 && leader) {
                leader.player1CardsObscured = true;
                playSoundEffect('confusao');
                announceEffect('!OÃSUFNOC', 'reversus');
                updateLog(`Inversus usou sua habilidade e confundiu as cartas de ${leader.name}!`);
                specialAbilityUsed = true;
            } else if (specialAbilityChance < 0.45 && leader && !gameState.necroXUsedThisRound) {
                await triggerNecroX(player);
                specialAbilityUsed = true;
            }

            for (const card of effectCards) {
                if (['Menos', 'Desce'].includes(card.name) && leader && 50 > bestMove.score) {
                    bestMove = { card, target: leader.id, score: 50, reason: "para atacar" };
                } else if (['Mais', 'Sobe'].includes(card.name) && 40 > bestMove.score) {
                    bestMove = { card, target: player.id, score: 40, reason: "para se fortalecer" };
                }
            }
        } else {
             // --- GENERAL AI LOGIC (used by 'default', Contravox, etc.) ---
            const leader = Object.values(gameState.players).filter(p => p.id !== player.id && !p.isEliminated).sort((a, b) => b.liveScore - a.liveScore)[0] || null;
            for (const card of effectCards) {
                if (['Mais', 'Sobe'].includes(card.name)) {
                    const isScoreEffect = card.name === 'Mais';
                    const currentEffect = isScoreEffect ? player.effects.score : player.effects.movement;
                    if (currentEffect !== card.name && 25 > bestMove.score) {
                        bestMove = { card, target: player.id, score: 25, reason: "para se ajudar" };
                    }
                }
                else if (['Menos', 'Desce'].includes(card.name) && leader) {
                    const isScoreEffect = card.name === 'Menos';
                    const categoryToCheck = isScoreEffect ? ['Mais', 'Menos'] : ['Sobe', 'Desce'];
                    const targetSlotLocked = leader.playedCards.effect.some(c => c.isLocked && categoryToCheck.includes(c.lockedEffect));
                    const currentEffect = isScoreEffect ? leader.effects.score : leader.effects.movement;
                    if (!targetSlotLocked && currentEffect !== card.name && 30 > bestMove.score) {
                        bestMove = { card, target: leader.id, score: 30, reason: "para atacar o líder" };
                    }
                }
                else if (card.name === 'Reversus') {
                    if ((player.effects.score === 'Menos' || player.effects.movement === 'Desce') && 40 > bestMove.score) {
                        const effectType = player.effects.score === 'Menos' ? 'score' : 'movement';
                        bestMove = { card, target: player.id, effectType, score: 40, reason: "para se defender" };
                    }
                    else if (leader && (leader.effects.score === 'Mais' || leader.effects.movement === 'Sobe') && 35 > bestMove.score) {
                        const effectType = leader.effects.score === 'Mais' ? 'score' : 'movement';
                        bestMove = { card, target: leader.id, effectType, score: 35, reason: "para atacar o líder" };
                    }
                }
                else if (card.name === 'Pula' && leader) {
                    const availablePaths = gameState.boardPaths.filter(p => !Object.values(gameState.players).map(pl => pl.pathId).includes(p.id));
                    if (availablePaths.length > 0 && 32 > bestMove.score) {
                        bestMove = { card, target: leader.id, score: 32, reason: "para reposicionar o líder" };
                    }
                }
            }
        } // end of AI personality block

        if (bestMove.score > 0) {
            if (bestMove.isReversumAbility) {
                gameState.reversumAbilityUsedThisRound = true;
            }
            
            updateLog(`AI ${player.name}: Decide jogar ${bestMove.card.name} ${bestMove.reason}.`);
            await new Promise(res => setTimeout(res, 800));

            if (bestMove.card.name === 'Pula') {
                const availablePaths = gameState.boardPaths.filter(p => !Object.values(gameState.players).map(pl => pl.pathId).includes(p.id));
                const targetPlayer = gameState.players[bestMove.target];
                targetPlayer.targetPathForPula = availablePaths[0].id; // AI picks the first available
            }
            let playOptions = {};
            if (bestMove.isIndividual) {
                playOptions.isIndividualLock = true;
                playOptions.effectNameToApply = bestMove.effectToLock;
            }
            await playCard(player, bestMove.card, bestMove.target, bestMove.effectType, playOptions);
            playedACard = true;
        }

        // --- Part 3: Pass the turn ---
        if (!playedACard && !specialAbilityUsed) {
            updateLog(`AI ${player.name}: Nenhuma jogada estratégica, passando o turno.`);
        } else {
            updateLog(`AI ${player.name}: Finalizou as jogadas e passou o turno.`);
        }

        await new Promise(res => setTimeout(res, 1000));
        gameState.consecutivePasses++;

    } catch (error) {
        console.error(`AI turn for ${player.name} failed:`, error);
        updateLog(`AI ${player.name} encontrou um erro e passará o turno.`);
        gameState.consecutivePasses++; // Still counts as a pass even on error
    } finally {
        gameState.gamePhase = 'playing';
        // Fire an event to signal the turn end, allowing the UI handler to advance the turn.
        // This decouples the AI from the turn manager, breaking a circular dependency.
        document.dispatchEvent(new Event('aiTurnEnded'));
    }
}
