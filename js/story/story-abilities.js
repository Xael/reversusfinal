
import { getState, updateState } from '../core/state.js';
import * as config from '../core/config.js';
import * as dom from '../core/dom.js';
import { updateLog, dealCard, shuffle } from '../core/utils.js';
import { renderAll } from '../ui/ui-renderer.js';
import { showGameOver } from '../ui/ui-renderer.js';
import { animateNecroX, shatterImage } from '../ui/animations.js';
import { playSoundEffect, announceEffect } from '../core/sound.js';
import { applyEffect } from '../game-logic/card-effects.js';
import { advanceToNextPlayer } from '../game-logic/turn-manager.js';


/**
 * Triggers the secret Xael challenge popup if conditions are met.
 * This is now a centralized function.
 */
export function triggerXaelChallengePopup() {
    const { gameState } = getState();
    if (gameState.isStoryMode && !gameState.xaelChallengeOffered && !gameState.xaelChallengeStarted && !gameState.isInversusMode) {
        gameState.xaelChallengeOffered = true; // Mark as offered to prevent repeats
        setTimeout(() => {
            playSoundEffect('xael');
            dom.xaelPopup.classList.remove('hidden');
            updateLog("Um Desafiante secreto apareceu!");
             // Add this to auto-hide the popup if not clicked
            setTimeout(() => {
                if (!dom.xaelPopup.classList.contains('hidden')) {
                    dom.xaelPopup.classList.add('hidden');
                }
            }, 4000); // Increased duration from 2s to 4s
        }, 1000); // 1 second delay
    }
}


/**
 * Triggers Necroverso's "NECRO X" ability, now reworked to apply a curse card.
 * @param {object} caster - The Necroverso player object.
 */
export async function triggerNecroX(caster) {
    const { gameState } = getState();
    const player1 = gameState.players['player-1'];
    
    // Check if player 1 has any cards to replace
    if (player1.hand.length === 0) {
        updateLog(`${caster.name} tentou usar Necro X, mas ${player1.name} não tinha cartas!`);
        return;
    }

    gameState.necroXUsedThisRound = true;
    updateLog({ type: 'dialogue', speaker: caster.aiType, message: `${caster.name}: "Sinta o poder da escuridão!"` });

    playSoundEffect('x');
    document.body.classList.add('screen-shaking');
    animateNecroX();

    setTimeout(() => document.body.classList.remove('screen-shaking'), 400);
    await new Promise(res => setTimeout(res, 1000));

    // Choose a random card from player 1's hand to replace
    const cardIndexToReplace = Math.floor(Math.random() * player1.hand.length);
    const originalCard = player1.hand[cardIndexToReplace];
    
    // Store the original card to give it back later
    player1.replacedCardByNecroX = originalCard;
    
    // Create the curse card
    const curseCard = { 
        id: Date.now() + Math.random(), 
        type: 'effect', 
        name: 'NECRO_X_CURSE', 
        isBlocked: true // This card cannot be played
    };

    // Replace the original card with the curse card
    player1.hand.splice(cardIndexToReplace, 1, curseCard);

    updateLog(`${caster.name} usou Necro X! Uma das cartas de ${player1.name} foi substituída por uma maldição por 1 rodada!`);
    
    renderAll();
}

/**
 * Checks for and triggers special abilities based on where a pawn lands.
 * This is called at the end of a round after all movements are calculated.
 * @param {object} player The player whose landing position is being checked.
 */
export async function checkAndTriggerPawnLandingAbilities(player) {
    const { gameState } = getState();
    if (!gameState.isStoryMode && !gameState.isKingNecroBattle) return;

    // --- Contravox Ability: !OÃSUFNOC ---
    // This ability triggers if player 1 lands on space 3, 6, or 9.
    const isContravoxBattle = gameState.currentStoryBattle === 'contravox';
    const isPlayer1 = player.id === 'player-1';
    const triggerPositions = [3, 6, 9];
    const isOnTriggerPosition = triggerPositions.includes(player.position);

    if (isContravoxBattle && isPlayer1 && isOnTriggerPosition) {
        if (gameState.contravoxAbilityUses > 0) {
            gameState.player1CardsObscured = true;
            gameState.contravoxAbilityUses--;
            playSoundEffect('confusao');
            announceEffect('!OÃSUFNOC', 'reversus');
            updateLog({ type: 'dialogue', speaker: 'contravox', message: 'Contravox: "!oãçurtsnoc ed sateL"' });
            updateLog(`A habilidade do Contravox foi ativada! Suas cartas foram obscurecidas para a próxima rodada.`);
        }
    }
}


/**
 * Triggers special effects when a player lands on a colored space.
 * This is now more robust and handles all special space types.
 */
export async function triggerFieldEffects() {
    const { gameState } = getState();
    const originalCurrentPlayer = gameState.currentPlayer;

    for (const id of gameState.playerIdsInGame) {
        const player = gameState.players[id];
        if (player.isEliminated || player.pathId === -1) continue;

        const path = gameState.boardPaths[player.pathId];
        if (!path || player.position < 1 || player.position > path.spaces.length) continue;
        
        const space = path.spaces[player.position - 1];

        if (space && !space.isUsed) {
            let instantEffectProcessed = false;

            // --- King Reversum Immunity ---
            if (space.color === 'red' && player.aiType === 'reversum') {
                updateLog(`Rei Reversum é imune ao efeito da casa vermelha!`);
                space.isUsed = true;
                renderAll();
                continue; // Skip to the next player
            }

            // Handle space color effects that happen immediately
            switch (space.color) {
                case 'black': {
                    instantEffectProcessed = true;
                    space.isUsed = true;
                    if (gameState.currentStoryBattle === 'necroverso_final') {
                         const teamA_Ids = ['player-1', 'player-4'];
                         const isTeamA = teamA_Ids.includes(player.id);
        
                         if (isTeamA) {
                            gameState.teamA_hearts = Math.max(0, gameState.teamA_hearts - 1);
                            updateLog(`Sua equipe caiu em um buraco negro e perdeu 1 coração! Restam: ${gameState.teamA_hearts}`);
                         } else { // Team B (Necroverso)
                            gameState.teamB_hearts = Math.max(0, gameState.teamB_hearts - 1);
                            updateLog(`A equipe do Necroverso caiu em um buraco negro e perdeu 1 coração! Restam: ${gameState.teamB_hearts}`);
                         }
                         playSoundEffect('coracao');
                         announceEffect('💔', 'heartbreak', 1500);

                         // Check for game end right after heart loss
                         if (gameState.teamA_hearts <= 0 || gameState.teamB_hearts <= 0) {
                            const player1Won = gameState.teamB_hearts <= 0;
                            gameState.gamePhase = 'game_over';
                            document.dispatchEvent(new CustomEvent('storyWinLoss', { detail: { battle: gameState.currentStoryBattle, won: player1Won } }));
                         }

                    } else {
                        playSoundEffect('destruido');
                        updateLog(`Jogador ${player.name} foi consumido por um buraco negro na casa ${space.id}!`);
                        player.isEliminated = true;
                        
                        const remainingPlayers = gameState.playerIdsInGame.filter(pId => !gameState.players[pId].isEliminated);
                        if (remainingPlayers.length <= 1 && gameState.isStoryMode) {
                            gameState.gamePhase = 'game_over';
                            const player1Won = remainingPlayers.includes('player-1');
                            document.dispatchEvent(new CustomEvent('storyWinLoss', { detail: { battle: gameState.currentStoryBattle, won: player1Won } }));
                            return; // Stop all further processing
                        }
                    }
                    break;
                }
                case 'yellow':
                    const isVersatrixPlayer = player.aiType === 'versatrix';
                    updateLog(`${player.name} parou na casa de Versatrix!`);
                    if (isVersatrixPlayer) {
                        player.position = Math.min(config.WINNING_POSITION, player.position + 1);
                        updateLog('Sendo Versatrix, ela avança uma casa!');
                    } else {
                        player.position = Math.max(1, player.position - 1);
                        updateLog('Como não é Versatrix, volta uma casa!');
                    }
                    dom.versatrixFieldModal.classList.remove('hidden');
                    await new Promise(resolve => {
                        const handler = () => {
                            dom.versatrixFieldContinueButton.removeEventListener('click', handler);
                            dom.versatrixFieldModal.classList.add('hidden');
                            resolve();
                        };
                        dom.versatrixFieldContinueButton.addEventListener('click', handler);
                    });
                    space.isUsed = true;
                    instantEffectProcessed = true;
                    break;

                case 'star':
                    playSoundEffect('conquista');
                    player.stars = (player.stars || 0) + 1;
                    updateLog(`Jogador ${player.name} coletou uma estrela! Total: ${player.stars}`);
                    space.isUsed = true;
                    instantEffectProcessed = true;
                    break;
            }
            
             // Handle effects for King Necro Battle (color only)
            if (gameState.isKingNecroBattle && !instantEffectProcessed && ['red', 'blue'].includes(space.color)) {
                const isPositive = space.color === 'blue';
                const effectName = isPositive ? shuffle(Object.keys(config.POSITIVE_EFFECTS))[0] : shuffle(Object.keys(config.NEGATIVE_EFFECTS))[0];
                const effectDesc = isPositive ? config.POSITIVE_EFFECTS[effectName] : config.NEGATIVE_EFFECTS[effectName];
                
                updateLog(`O caminho do Rei Necroverso ativa um efeito! Efeito: ${effectName}`);
                
                dom.fieldEffectCardEl.className = `field-effect-card ${isPositive ? 'positive' : 'negative'}`;
                dom.fieldEffectNameEl.textContent = effectName;
                dom.fieldEffectDescriptionEl.textContent = effectDesc;
                dom.fieldEffectModal.classList.remove('hidden');
                
                await new Promise(resolve => {
                    const handler = () => {
                        dom.fieldEffectContinueButton.removeEventListener('click', handler);
                        dom.fieldEffectModal.classList.add('hidden');
                        resolve();
                    };
                    dom.fieldEffectContinueButton.addEventListener('click', handler);
                });
                
                gameState.activeFieldEffects.push({ name: effectName, type: isPositive ? 'positive' : 'negative', appliesTo: player.id });
                space.isUsed = true;
            } else if (space.effectName && !instantEffectProcessed) {
                // Original logic for other modes
                const isPositive = space.color === 'blue';
                updateLog(`Jogador ${player.name} parou em uma casa ${isPositive ? 'azul' : 'vermelha'}! Efeito: ${space.effectName}`);
                
                dom.fieldEffectCardEl.className = `field-effect-card ${isPositive ? 'positive' : 'negative'}`;
                dom.fieldEffectNameEl.textContent = space.effectName;
                dom.fieldEffectDescriptionEl.textContent = isPositive ? config.POSITIVE_EFFECTS[space.effectName] : config.NEGATIVE_EFFECTS[space.effectName];
                dom.fieldEffectModal.classList.remove('hidden');
                
                await new Promise(resolve => {
                    const handler = () => {
                        dom.fieldEffectContinueButton.removeEventListener('click', handler);
                        dom.fieldEffectModal.classList.add('hidden');
                        resolve();
                    };
                    dom.fieldEffectContinueButton.addEventListener('click', handler);
});

                // Add to active effects for round-end calculations
                gameState.activeFieldEffects.push({
                    name: space.effectName, type: isPositive ? 'positive' : 'negative', appliesTo: player.id
                });
                space.isUsed = true;
            }
        }
    }
    // Restore the current player in case it was changed by elimination
    gameState.currentPlayer = originalCurrentPlayer;
    renderAll();
}


/**
 * Makes an AI player "speak" a line of dialogue based on the game situation.
 * @param {object} player - The AI player object.
 */
export async function tryToSpeak(player) {
    const { gameState } = getState();
    const aiType = player.aiType;

    // Do not speak if this AI type has no dialogue configured
    if (!config.AI_DIALOGUE[aiType] || (!config.AI_DIALOGUE[aiType].winning && !config.AI_DIALOGUE[aiType].losing)) {
        return;
    }

    // Determine if the player is generally winning or losing based on board position
    const otherPlayerPositions = gameState.playerIdsInGame
        .filter(id => id !== player.id && !gameState.players[id].isEliminated)
        .map(id => gameState.players[id].position);
    
    if (otherPlayerPositions.length === 0) return; // No one else to compare to

    const avgOpponentPosition = otherPlayerPositions.reduce((a, b) => a + b, 0) / otherPlayerPositions.length;
    const status = player.position > avgOpponentPosition ? 'winning' : 'losing';
    const lines = config.AI_DIALOGUE[aiType][status];

    if (lines && lines.length > 0) {
        // Find a line that hasn't been said yet
        let lineToSay = lines.find(line => !gameState.dialogueState.spokenLines.has(`${aiType}-${line}`));
        
        // If all lines for this status have been said, reset them for this character and status
        if (!lineToSay) {
            lines.forEach(line => gameState.dialogueState.spokenLines.delete(`${aiType}-${line}`));
            lineToSay = lines[0]; // Say the first one again
        }
        
        if (lineToSay) {
            updateLog({ type: 'dialogue', speaker: aiType, message: `${player.name}: "${lineToSay}"` });
            gameState.dialogueState.spokenLines.add(`${aiType}-${lineToSay}`);
            await new Promise(res => setTimeout(res, 500));
        }
    }
}
