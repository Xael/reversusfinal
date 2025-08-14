import * as dom from '../core/dom.js';
import { getState, updateState } from '../core/state.js';
import { initializeGame, restartLastDuel } from '../game-controller.js';
import { renderPvpRooms, updateLobbyUi, addLobbyChatMessage } from './lobby-renderer.js';
import { showSplashScreen } from './splash-screen.js';
import { renderAchievementsModal } from './achievements-renderer.js';
import { renderAll, updateActionButtons, showGameOver } from './ui-renderer.js';
import * as sound from '../core/sound.js';
import { startStoryMode, renderStoryNode, playEndgameSequence } from '../story/story-controller.js';
import * as saveLoad from '../core/save-load.js';
import * as achievements from '../core/achievements.js';
import { updateLog } from '../core/utils.js';
import * as config from '../core/config.js';
import { playCard } from '../game-logic/player-actions.js';
import { advanceToNextPlayer } from '../game-logic/turn-manager.js';
import { getAiChatResponse } from '../ai/gemini-chat.js';
import { createCosmicGlowOverlay, shatterImage } from './animations.js';
import { announceEffect } from '../core/sound.js';

/**
 * Resets the game state after a player cancels an action modal.
 * This is crucial to prevent the UI from getting stuck.
 */
function cancelPlayerAction() {
    const { gameState } = getState();

    // Hide all relevant action modals
    dom.targetModal.classList.add('hidden');
    dom.reversusTargetModal.classList.add('hidden');
    dom.reversusTotalChoiceModal.classList.add('hidden');
    dom.reversusIndividualEffectChoiceModal.classList.add('hidden');
    dom.pulaModal.classList.add('hidden');

    // Reset game state to a clean "playing" state
    if (gameState) {
        gameState.gamePhase = 'playing';
        gameState.selectedCard = null; // This is the key fix
        gameState.reversusTarget = null;
        gameState.pulaTarget = null;
        updateState('reversusTotalIndividualFlow', false);
    }

    // Re-render everything to reflect the changes (e.g., deselect card, update buttons)
    renderAll();
}


function handleCardClick(cardElement) {
    const { gameState } = getState();
    const cardId = parseFloat(cardElement.dataset.cardId);
    if (!gameState || gameState.currentPlayer !== 'player-1' || gameState.gamePhase !== 'playing' || isNaN(cardId)) {
        return;
    }

    const player = gameState.players['player-1'];
    const card = player.hand.find(c => c.id === cardId);

    if (card) {
        if (cardElement.classList.contains('disabled')) return;
        
        // Disable Versatrix card if on cooldown
        if (card.name === 'Carta da Versatrix' && card.cooldown > 0) {
            updateLog(`A Carta da Versatrix está em recarga por mais ${card.cooldown} rodada(s).`);
            return;
        }

        gameState.selectedCard = (gameState.selectedCard?.id === cardId) ? null : card;
        renderAll();
    }
}

async function handlePlayButtonClick() {
    // Prevent multiple clicks while the action is processing.
    dom.playButton.disabled = true;

    const { gameState } = getState();
    const card = gameState.selectedCard;

    if (!card) {
        // This case should ideally not happen if the button was enabled, but as a safeguard:
        updateActionButtons(); // Re-evaluate and set button state correctly.
        return;
    }

    if (card.name === 'Reversus Total') {
        dom.reversusTotalChoiceModal.classList.remove('hidden');
    } else if (['Mais', 'Menos', 'Sobe', 'Desce', 'Reversus', 'Pula', 'Carta da Versatrix'].includes(card.name)) {
        gameState.gamePhase = 'targeting';
        dom.targetModalCardName.textContent = gameState.player1CardsObscured ? "Efeito Desconhecido" : card.name;
        dom.targetPlayerButtonsEl.innerHTML = gameState.playerIdsInGame
            .map(id => {
                const player = gameState.players[id];
                if (player.isEliminated) return '';
                return `<button class="control-button target-player-${id.split('-')[1]}" data-player-id="${id}">${player.name}</button>`;
            })
            .join('');
        dom.targetModal.classList.remove('hidden');
    } else { // Value card
        playCard(gameState.players['player-1'], card, 'player-1');
    }
}

async function handlePlayerTargetSelection(targetId) {
    const { gameState } = getState();
    
    if (getState().reversusTotalIndividualFlow) {
        dom.targetModal.classList.add('hidden');
        gameState.reversusTarget = { card: gameState.selectedCard, targetPlayerId: targetId };
        gameState.gamePhase = 'reversus_targeting';
        dom.reversusIndividualEffectChoiceModal.classList.remove('hidden');
        updateActionButtons();
        return;
    }

    if (!gameState.selectedCard) return;
    const card = gameState.selectedCard;
    dom.targetModal.classList.add('hidden');
    
    const isConfused = gameState.player1CardsObscured;

    if (card.name === 'Reversus') {
        if (isConfused) {
            const effectTypeToReverse = Math.random() < 0.5 ? 'score' : 'movement';
            updateLog("Efeito de Reversus desconhecido foi aplicado aleatoriamente!");
            gameState.gamePhase = 'playing';
            playCard(gameState.players['player-1'], card, targetId, effectTypeToReverse);
        } else {
            gameState.reversusTarget = { card, targetPlayerId: targetId };
            gameState.gamePhase = 'reversus_targeting';
            dom.reversusTargetModal.classList.remove('hidden');
            updateActionButtons();
        }
    } else if (card.name === 'Pula') {
        const availablePaths = gameState.boardPaths.filter(p => !Object.values(gameState.players).map(pl => pl.pathId).includes(p.id));
        if (availablePaths.length === 0) {
            alert("Não há caminhos vazios para pular! A jogada foi cancelada.");
            updateLog("Tentativa de jogar 'Pula' falhou: Nenhum caminho vazio disponível.");
            cancelPlayerAction();
            return;
        }

        if (isConfused) {
            const randomPath = availablePaths[Math.floor(Math.random() * availablePaths.length)];
            const targetPlayer = gameState.players[targetId];
            targetPlayer.targetPathForPula = randomPath.id;
            updateLog(`Efeito de Pula desconhecido moveu ${targetPlayer.name} para um caminho aleatório!`);
            gameState.gamePhase = 'playing';
            playCard(gameState.players['player-1'], card, targetId);
        } else {
            gameState.pulaTarget = { card, targetPlayerId: targetId };
            handlePulaCasterChoice(card, targetId);
        }
    } else {
        gameState.gamePhase = 'playing';
        playCard(gameState.players['player-1'], card, targetId);
    }
}

function handlePulaCasterChoice(card, targetId) {
    const { gameState } = getState();
    gameState.gamePhase = 'pula_casting';
    const target = gameState.players[targetId];

    dom.pulaModalTitle.textContent = `Jogar 'Pula' em ${target.name}`;
    dom.pulaModalText.textContent = `Escolha um caminho vazio para ${target.name} pular:`;
    dom.pulaCancelButton.classList.remove('hidden');
    
    dom.pulaPathButtonsEl.innerHTML = gameState.boardPaths.map(path => {
        const pathOccupant = Object.values(gameState.players).find(player => player.pathId === path.id);
        const isOccupied = !!pathOccupant;
        const isDisabled = isOccupied;
        return `<button class="control-button" data-path-id="${path.id}" ${isDisabled ? 'disabled' : ''}>Caminho ${path.id + 1} ${isOccupied ? `(Ocupado por ${pathOccupant.name})` : '(Vazio)'}</button>`
    }).join('');

    dom.pulaModal.classList.remove('hidden');
    updateActionButtons();
}

async function handlePulaPathSelection(chosenPathId) {
    const { gameState } = getState();
    if (!gameState.pulaTarget) return;

    const { card, targetPlayerId } = gameState.pulaTarget;
    const target = gameState.players[targetPlayerId];
    target.targetPathForPula = chosenPathId;
    updateLog(`${gameState.players['player-1'].name} escolheu que ${target.name} pule para o caminho ${chosenPathId + 1}.`);
    
    dom.pulaModal.classList.add('hidden');
    gameState.gamePhase = 'playing';

    let playOptions = {};
    // Check if we are in the Reversus Total individual lock flow
    if (card.name === 'Reversus Total') {
        updateState('reversusTotalIndividualFlow', false);
        playOptions = {
            isIndividualLock: true,
            effectNameToApply: 'Pula',
        };
    }

    playCard(gameState.players['player-1'], card, targetPlayerId, null, playOptions);
}

async function handleReversusEffectTypeSelection(effectTypeToReverse) {
    const { gameState } = getState();
    if (!gameState.reversusTarget) return;
    const { card, targetPlayerId } = gameState.reversusTarget;
    dom.reversusTargetModal.classList.add('hidden');
    gameState.gamePhase = 'playing';
    playCard(gameState.players['player-1'], card, targetPlayerId, effectTypeToReverse);
}

async function handleReversusTotalChoice(isGlobal) {
    const { gameState } = getState();
    const card = gameState.selectedCard;
    dom.reversusTotalChoiceModal.classList.add('hidden');

    if (isGlobal) {
        gameState.gamePhase = 'playing';
        playCard(gameState.players['player-1'], card, 'player-1', null, { isGlobal: true });
    } else {
        updateState('reversusTotalIndividualFlow', true);
        gameState.gamePhase = 'targeting';
        dom.targetModalCardName.textContent = "Travar Efeito";
        dom.targetPlayerButtonsEl.innerHTML = gameState.playerIdsInGame
            .map(id => {
                const player = gameState.players[id];
                if (player.isEliminated) return '';
                return `<button class="control-button target-player-${id.split('-')[1]}" data-player-id="${id}">${player.name}</button>`;
            })
            .join('');
        dom.targetModal.classList.remove('hidden');
    }
}

async function handleIndividualEffectLock(effectName) {
    const { gameState } = getState();
    if (!gameState.reversusTarget) return;

    const { card, targetPlayerId } = gameState.reversusTarget;
    dom.reversusIndividualEffectChoiceModal.classList.add('hidden');

    if (effectName === 'Pula') {
        const availablePaths = gameState.boardPaths.filter(p => !Object.values(gameState.players).map(pl => pl.pathId).includes(p.id));
        if (availablePaths.length === 0) {
            alert("Não há caminhos vazios para pular! A jogada foi cancelada.");
            cancelPlayerAction();
            return;
        }
        // Set the pulaTarget state. The card is Reversus Total, which is used by handlePulaPathSelection to know it's a lock.
        gameState.pulaTarget = { card, targetPlayerId };
        // Open the same path selection modal as a normal 'Pula' card.
        handlePulaCasterChoice(card, targetPlayerId);
    } else {
        // Original logic for other effects
        updateState('reversusTotalIndividualFlow', false);
        gameState.gamePhase = 'playing';
        playCard(gameState.players['player-1'], card, targetPlayerId, null, {
            isIndividualLock: true,
            effectNameToApply: effectName,
        });
    }
}

async function handleChatSend() {
    const input = dom.chatInput.value.trim();
    if (!input) return;
    updateLog({ type: 'dialogue', speaker: 'player-1', message: `Você: "${input}"` });
    dom.chatInput.value = '';

    const response = await getAiChatResponse(input);
    updateLog({ type: 'dialogue', speaker: 'default', message: `IA: "${response}"` });
}

async function animateBossDefeat(battleId) {
    const { gameState } = getState();
    const bossPlayer = Object.values(gameState.players).find(p => p.aiType === battleId);
    if (!bossPlayer) return;

    const bossImageEl = document.querySelector(`#player-area-${bossPlayer.id} .player-area-character-portrait`);
    if (bossImageEl) {
        await shatterImage(bossImageEl);
    }
}


async function handleStoryWinLoss(e) {
    const { battle, won } = e.detail;

    dom.appContainerEl.classList.add('hidden');
    dom.debugButton.classList.add('hidden');
    dom.gameOverModal.classList.add('hidden'); 

    const { gameTimerInterval } = getState();
    if (gameTimerInterval) clearInterval(gameTimerInterval);
    updateState('gameTimerInterval', null);

    let nextNode;
    const bossesToShatter = ['contravox', 'versatrix', 'reversum'];

    if (won && bossesToShatter.includes(battle)) {
        dom.appContainerEl.classList.remove('hidden');
        await animateBossDefeat(battle);
        dom.appContainerEl.classList.add('hidden');
    }


    switch (battle) {
        case 'tutorial_necroverso':
            nextNode = won ? 'post_tutorial' : 'tutorial_loss';
            if (won) achievements.grantAchievement('tutorial_win');
            break;
        case 'contravox':
            nextNode = won ? 'post_contravox_victory' : 'start_contravox';
            if (won) achievements.grantAchievement('contravox_win');
            break;
        case 'versatrix':
            const { storyState } = getState();
            storyState.lostToVersatrix = !won;
            updateState('storyState', storyState);
            if (won) {
                achievements.grantAchievement('versatrix_win');
                nextNode = 'post_versatrix_victory';
            } else {
                achievements.grantAchievement('versatrix_loss');
                nextNode = 'post_versatrix_defeat';
            }
            break;
         case 'reversum':
            nextNode = won ? 'post_reversum_victory' : 'start_reversum';
            if(won) achievements.grantAchievement('reversum_win');
            break;
         case 'necroverso_king':
            nextNode = won ? 'post_necroverso_king_victory' : 'final_confrontation_1';
            if(won) achievements.grantAchievement('true_end_beta');
            break;
         case 'necroverso_final':
            if (won) {
                achievements.grantAchievement('true_end_final');
                playEndgameSequence();
            } else {
                showGameOver(
                    "Sua equipe foi derrotada... mas a luta ainda não acabou.",
                    "Derrota",
                    { text: 'Tentar Novamente', action: 'restart' }
                );
                updateState('lastStoryGameOptions', { mode: 'duo', options: getState().gameState.gameOptions });
            }
            return;
        case 'inversus':
            if (won) {
                achievements.grantAchievement('inversus_win');
            }
            showSplashScreen();
            return;
        case 'narrador':
            if (won) {
                achievements.grantAchievement('120%_unlocked');
            }
            showSplashScreen();
            return;
        case 'xael_challenge':
            dom.cosmicGlowOverlay.classList.add('hidden');
            if (won) {
                achievements.grantAchievement('xael_win');
                restartLastDuel();
            } else {
                showGameOver(
                    "Você não conseguiu superar o desafio.",
                    "Fim do Desafio",
                    { text: 'Voltar ao Menu', action: 'menu' }
                );
            }
            return;
        case 'return_to_menu':
            showSplashScreen();
            return;
    }

    if (nextNode) {
        dom.storyModeModalEl.classList.remove('hidden');
        renderStoryNode(nextNode);
    } else { 
        showSplashScreen();
    }
}

async function handleRandomOpponentSelection() {
    dom.randomOpponentSpinnerModal.classList.remove('hidden');

    const opponents = [
        { name: 'Necroverso', aiType: 'necroverso_tutorial', image: './necroverso.png' },
        { name: 'Necroverso Final', aiType: 'necroverso_final', image: './necroverso2.png' },
        { name: 'Contravox', aiType: 'contravox', image: './contravox.png' },
        { name: 'Versatrix', aiType: 'versatrix', image: './versatrix.png' },
        { name: 'Rei Reversum', aiType: 'reversum', image: './reversum.png' },
        { name: 'Inversus', aiType: 'inversus', image: './inversum1.png' },
        { name: 'Xael', aiType: 'xael', image: './xaeldesafio.png' },
        { name: 'Narrador', aiType: 'narrador', image: './narrador.png' }
    ];

    let spinnerInterval;
    const spinnerPromise = new Promise(resolve => {
        let i = 0;
        spinnerInterval = setInterval(() => {
            const currentOpponent = opponents[i % opponents.length];
            dom.opponentSpinnerImage.src = currentOpponent.image;
            dom.opponentSpinnerName.textContent = currentOpponent.name;
            i++;
        }, 100); // Cycle every 100ms

        setTimeout(() => {
            clearInterval(spinnerInterval);
            resolve();
        }, 3000); // Spin for 3 seconds
    });

    await spinnerPromise;

    const chosenOpponent = opponents[Math.floor(Math.random() * opponents.length)];

    // Display the final choice
    dom.opponentSpinnerImage.style.animation = 'none'; // Stop flicker
    dom.opponentSpinnerImage.src = chosenOpponent.image;
    dom.opponentSpinnerName.textContent = chosenOpponent.name;
    dom.randomOpponentSpinnerModal.querySelector('h2').textContent = 'Oponente Escolhido!';
    sound.playSoundEffect('escolhido');

    // Wait a moment before starting the game
    await new Promise(resolve => setTimeout(resolve, 2000));

    dom.randomOpponentSpinnerModal.classList.add('hidden');
    // Reset modal for next time
    dom.randomOpponentSpinnerModal.querySelector('h2').textContent = 'Sorteando Oponente...';
    dom.opponentSpinnerImage.style.animation = 'opponent-flicker 0.1s linear infinite';
    
    // Start the game with the chosen opponent
    initializeGame('solo', { numPlayers: 2, overrides: { 'player-2': { name: chosenOpponent.name, aiType: chosenOpponent.aiType } } });
}


export function initializeUiHandlers() {
    // Listen for the end of an AI turn to advance to the next player.
    // This breaks a circular dependency between the AI controller and turn manager.
    document.addEventListener('aiTurnEnded', advanceToNextPlayer);

    document.addEventListener('showSplashScreen', showSplashScreen);
    document.addEventListener('playEndgameSequence', () => import('../story/story-controller.js').then(module => module.playEndgameSequence()));
    
    document.addEventListener('startStoryGame', (e) => {
        const { mode, options } = e.detail;
    
        // Robustly get battleId, even if options is null/undefined
        const battleId = options?.story?.battle;
    
        // Handle special "meta" actions first
        if (battleId === 'return_to_menu') {
            showSplashScreen();
            return;
        }
    
        // Save the game options for the "try again" feature, but only for main story duels
        if (battleId && !['xael_challenge', 'narrador', 'tutorial_necroverso'].includes(battleId)) {
            updateState('lastStoryGameOptions', { mode, options });
        }
        
        // It's a real game, so initialize it. Guard against undefined options just in case.
        if (options) {
            initializeGame(mode, options);
        } else {
            console.error("startStoryGame event fired with invalid options. Returning to menu.", e.detail);
            showSplashScreen();
        }
    });
    
    document.addEventListener('storyWinLoss', handleStoryWinLoss);


    // Splash Screen
    dom.quickStartButton.addEventListener('click', () => {
        sound.initializeMusic();
        dom.splashScreenEl.classList.add('hidden');
        dom.gameSetupModal.classList.remove('hidden');
    });
    dom.storyModeButton.addEventListener('click', startStoryMode);
    dom.inversusModeButton.addEventListener('click', () => {
        sound.initializeMusic();
        initializeGame('inversus', { numPlayers: 2, overrides: { 'player-2': { name: 'Inversus', aiType: 'inversus' } } });
    });
    dom.pvpModeButton.addEventListener('click', () => {
        sound.initializeMusic();
        renderPvpRooms();
        dom.pvpRoomListModal.classList.remove('hidden');
    });
    dom.instructionsButton.addEventListener('click', () => { dom.rulesModal.classList.remove('hidden'); });
    dom.creditsButton.addEventListener('click', () => { dom.creditsModal.classList.remove('hidden'); });
    dom.continueButton.addEventListener('click', saveLoad.loadGameState);
    dom.achievementsButton.addEventListener('click', () => { renderAchievementsModal(); dom.achievementsModal.classList.remove('hidden'); });
    dom.splashLogo.addEventListener('click', () => {
        if (dom.splashLogo.classList.contains('effect-glitch')) {
            sound.initializeMusic();
            const { achievements } = getState();
            if (achievements.has('inversus_win') && !achievements.has('120%_unlocked')) {
                 initializeGame('solo', { story: { battle: 'narrador', playerIds: ['player-1', 'player-2'], overrides: { 'player-2': { name: 'Narrador', aiType: 'narrador' } } } });
            }
        }
    });

    // Modals
    dom.closeRulesButton.addEventListener('click', () => dom.rulesModal.classList.add('hidden'));
    dom.closeCreditsButton.addEventListener('click', () => dom.creditsModal.classList.add('hidden'));
    dom.closeAchievementsButton.addEventListener('click', () => dom.achievementsModal.classList.add('hidden'));
    dom.versatrixCardInfoContinueButton.addEventListener('click', () => dom.versatrixCardInfoModal.classList.add('hidden'));
    dom.fieldEffectInfoCloseButton.addEventListener('click', () => dom.fieldEffectInfoModal.classList.add('hidden'));
    dom.versatrixFieldContinueButton.addEventListener('click', () => dom.versatrixFieldModal.classList.add('hidden'));

    
    // Game Setup
    dom.solo2pButton.addEventListener('click', () => {
        dom.gameSetupModal.classList.add('hidden');
        dom.oneVOneSetupModal.classList.remove('hidden');
    });
    dom.oneVOneDefaultButton.addEventListener('click', () => {
        dom.oneVOneSetupModal.classList.add('hidden');
        initializeGame('solo', { numPlayers: 2 });
    });
    dom.oneVOneRandomButton.addEventListener('click', () => {
        dom.oneVOneSetupModal.classList.add('hidden');
        handleRandomOpponentSelection();
    });
    dom.oneVOneBackButton.addEventListener('click', () => {
        dom.oneVOneSetupModal.classList.add('hidden');
        dom.gameSetupModal.classList.remove('hidden');
    });
    
    const setupGame = (numPlayers, mode = 'solo') => {
        dom.gameSetupModal.classList.add('hidden');
        initializeGame(mode, { numPlayers });
    };
    
    dom.solo3pButton.addEventListener('click', () => setupGame(3));
    dom.solo4pButton.addEventListener('click', () => setupGame(4));
    dom.duoModeButton.addEventListener('click', () => setupGame(4, 'duo'));
    dom.closeSetupButton.addEventListener('click', () => {
        dom.gameSetupModal.classList.add('hidden');
        dom.splashScreenEl.classList.remove('hidden');
    });

    // In-Game actions
    dom.playButton.addEventListener('click', handlePlayButtonClick);
    dom.endTurnButton.addEventListener('click', async () => {
        const { gameState } = getState();
        if (!gameState || !gameState.players['player-1'] || gameState.gamePhase !== 'playing') return;

        // Defensive check to enforce the "Golden Rule"
        const player = gameState.players['player-1'];
        const valueCardsInHandCount = player.hand.filter(c => c.type === 'value').length;
        const mustPlayValueCard = valueCardsInHandCount > 1 && !player.playedValueCardThisTurn;

        if (mustPlayValueCard) {
            updateLog("Ação ilegal: Você deve jogar uma carta de valor antes de passar o turno.");
            alert("Você precisa jogar uma carta de valor neste turno!");
            return; // Abort passing the turn
        }

        updateLog(`Você passou o turno.`);
        gameState.consecutivePasses++;
        await advanceToNextPlayer();
    });
    dom.appContainerEl.addEventListener('click', (e) => {
        const cardElement = e.target.closest('.card');
        const maximizeButton = e.target.closest('.card-maximize-button');
        const fieldEffectIndicator = e.target.closest('.field-effect-indicator');

        if (maximizeButton && cardElement) {
            e.stopPropagation();
            dom.cardViewerImageEl.src = cardElement.style.backgroundImage.slice(4, -1).replace(/"/g, "");
            dom.cardViewerModalEl.classList.remove('hidden');
        } else if (cardElement) {
            handleCardClick(cardElement);
        } else if (fieldEffectIndicator) {
            const playerId = fieldEffectIndicator.dataset.playerId;
            const { gameState } = getState();
            const effect = gameState.activeFieldEffects.find(fe => fe.appliesTo === playerId);
            if (effect) {
                const isPositive = effect.type === 'positive';
                dom.fieldEffectInfoModal.querySelector('.field-effect-card').className = `field-effect-card ${isPositive ? 'positive' : 'negative'}`;
                dom.fieldEffectInfoName.textContent = effect.name;
                dom.fieldEffectInfoDescription.textContent = isPositive ? config.POSITIVE_EFFECTS[effect.name] : config.NEGATIVE_EFFECTS[effect.name];
                dom.fieldEffectInfoModal.classList.remove('hidden');
            }
        }
    });
    dom.cardViewerCloseButton.addEventListener('click', () => dom.cardViewerModalEl.classList.add('hidden'));

    // Targeting Modals - All cancel buttons now use the robust handler
    dom.targetPlayerButtonsEl.addEventListener('click', e => {
        if (e.target.matches('[data-player-id]')) {
            handlePlayerTargetSelection(e.target.dataset.playerId);
        }
    });
    dom.targetCancelButton.addEventListener('click', cancelPlayerAction);

    dom.reversusTargetScoreButton.addEventListener('click', () => handleReversusEffectTypeSelection('score'));
    dom.reversusTargetMovementButton.addEventListener('click', () => handleReversusEffectTypeSelection('movement'));
    dom.reversusTargetCancelButton.addEventListener('click', cancelPlayerAction);

    dom.reversusTotalGlobalButton.addEventListener('click', () => handleReversusTotalChoice(true));
    dom.reversusTotalIndividualButton.addEventListener('click', () => handleReversusTotalChoice(false));
    dom.reversusTotalChoiceCancel.addEventListener('click', cancelPlayerAction);

    dom.reversusIndividualEffectButtons.addEventListener('click', (e) => {
        if (e.target.matches('[data-effect]')) {
            handleIndividualEffectLock(e.target.dataset.effect);
        }
    });
    dom.reversusIndividualCancelButton.addEventListener('click', cancelPlayerAction);
    
    dom.pulaPathButtonsEl.addEventListener('click', e => {
        if(e.target.matches('[data-path-id]')){
            handlePulaPathSelection(parseInt(e.target.dataset.pathId, 10));
        }
    });
    dom.pulaCancelButton.addEventListener('click', cancelPlayerAction);

    // Field Effect Target Modal
    dom.fieldEffectTargetButtons.addEventListener('click', e => {
        if (e.target.matches('[data-player-id]')) {
            const { fieldEffectTargetResolver } = getState();
            if (fieldEffectTargetResolver) {
                fieldEffectTargetResolver(e.target.dataset.playerId);
                updateState('fieldEffectTargetResolver', null);
            }
        }
    });

    // Game Over & Restart
    dom.restartButton.addEventListener('click', (e) => {
        const action = e.currentTarget.dataset.action;
        dom.gameOverModal.classList.add('hidden');

        if (action === 'menu') {
            showSplashScreen();
        } else { // 'restart' or default
            const { gameState, lastStoryGameOptions } = getState();
            if (gameState && gameState.isStoryMode && lastStoryGameOptions) {
                restartLastDuel();
            } else if (gameState) {
                 const mode = gameState.gameMode;
                 const numPlayers = gameState.playerIdsInGame.length;
                 initializeGame(mode, { numPlayers, overrides: {} });
            } else {
                 showSplashScreen(); // Fallback
            }
        }
    });
    
    // Chat
    dom.chatSendButton.addEventListener('click', handleChatSend);
    dom.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleChatSend();
    });

    // Sound and Fullscreen
    dom.muteButton.addEventListener('click', sound.toggleMute);
    dom.volumeSlider.addEventListener('input', (e) => sound.setVolume(parseFloat(e.target.value)));
    dom.nextTrackButton.addEventListener('click', sound.changeTrack);
    dom.fullscreenButton.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
            dom.fullscreenButton.querySelector('#fullscreen-icon-enter').classList.add('hidden');
            dom.fullscreenButton.querySelector('#fullscreen-icon-exit').classList.remove('hidden');
        } else if (document.exitFullscreen) {
            document.exitFullscreen();
            dom.fullscreenButton.querySelector('#fullscreen-icon-enter').classList.remove('hidden');
            dom.fullscreenButton.querySelector('#fullscreen-icon-exit').classList.add('hidden');
        }
    });

    // In-Game Menu
    dom.debugButton.addEventListener('click', () => dom.gameMenuModal.classList.remove('hidden'));
    dom.gameMenuCloseButton.addEventListener('click', () => dom.gameMenuModal.classList.add('hidden'));
    dom.menuSaveGameButton.addEventListener('click', () => {
        dom.gameMenuModal.classList.add('hidden');
        dom.saveGameConfirmModal.classList.remove('hidden');
    });
    dom.menuExitGameButton.addEventListener('click', () => {
        dom.gameMenuModal.classList.add('hidden');
        dom.exitGameConfirmModal.classList.remove('hidden');
    });

    // Confirmation Modals
    dom.saveGameYesButton.addEventListener('click', saveLoad.saveGameState);
    dom.saveGameNoButton.addEventListener('click', () => dom.saveGameConfirmModal.classList.add('hidden'));
    dom.exitGameYesButton.addEventListener('click', () => {
        dom.exitGameConfirmModal.classList.add('hidden');
        showSplashScreen();
    });
    dom.exitGameNoButton.addEventListener('click', () => dom.exitGameConfirmModal.classList.add('hidden'));

    // PVP Handlers
    dom.pvpRoomGridEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('pvp-enter-room-button')) {
            const roomId = parseInt(e.target.dataset.roomId, 10);
            const room = getState().pvpRooms.find(r => r.id === roomId);
            if (room && room.password) {
                updateState('currentEnteringRoomId', roomId);
                dom.pvpPasswordModal.classList.remove('hidden');
            } else if (room) {
                dom.pvpRoomListModal.classList.add('hidden');
                dom.pvpLobbyModal.classList.remove('hidden');
                updateLobbyUi(roomId);
            }
        }
    });
    dom.pvpRoomListCloseButton.addEventListener('click', showSplashScreen);
    
    dom.pvpPasswordSubmit.addEventListener('click', () => {
        const { pvpRooms, currentEnteringRoomId } = getState();
        const room = pvpRooms.find(r => r.id === currentEnteringRoomId);
        if (room && dom.pvpPasswordInput.value === room.password) {
            dom.pvpPasswordModal.classList.add('hidden');
            dom.pvpPasswordInput.value = '';
            dom.pvpRoomListModal.classList.add('hidden');
            dom.pvpLobbyModal.classList.remove('hidden');
            updateLobbyUi(room.id);
        } else {
            alert('Senha incorreta!');
            dom.pvpPasswordInput.value = '';
        }
    });

    dom.pvpPasswordCancel.addEventListener('click', () => dom.pvpPasswordModal.classList.add('hidden'));

    dom.pvpLobbyCloseButton.addEventListener('click', () => {
        dom.pvpLobbyModal.classList.add('hidden');
        renderPvpRooms();
        dom.pvpRoomListModal.classList.remove('hidden');
    });
    dom.lobbyGameModeEl.addEventListener('change', () => updateLobbyUi(1)); // Assume room 1 for now

    dom.lobbyStartGameButton.addEventListener('click', () => {
        const selectedModeValue = dom.lobbyGameModeEl.value; // e.g., 'solo-2p'
        const isDuo = selectedModeValue === 'duo';
        const numPlayers = { 'solo-2p': 2, 'solo-3p': 3, 'solo-4p': 4, 'duo': 4 }[selectedModeValue] || 4;
        
        const overrides = {};
        for (let i = 2; i <= numPlayers; i++) {
            const selectEl = document.getElementById(`lobby-ai-p${i}`);
            if (selectEl && selectEl.value) {
                overrides[`player-${i}`] = { aiType: selectEl.value };
            }
        }
        
        initializeGame(isDuo ? 'duo' : 'solo', { numPlayers, overrides });
    });

    const handleLobbyChat = () => {
        const message = dom.lobbyChatInput.value.trim();
        if (message) {
            addLobbyChatMessage('Você', message);
            dom.lobbyChatInput.value = '';
            // Simulate AI response
            setTimeout(() => addLobbyChatMessage('I.A.', '...'), 1000);
        }
    };
    dom.lobbyChatSendButton.addEventListener('click', handleLobbyChat);
    dom.lobbyChatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleLobbyChat();
    });

    // Secret Splash Screen Card
    dom.splashAnimationContainerEl.addEventListener('click', e => {
        if (e.target.id === 'secret-versatrix-card') {
            achievements.grantAchievement('versatrix_card_collected');
            e.target.remove();
            // Clear interval to stop more from spawning
            const { versatrixCardInterval } = getState();
            if (versatrixCardInterval) clearInterval(versatrixCardInterval);
            updateState('versatrixCardInterval', null);
        }
    });

    // Xael Challenge
    dom.xaelPopup.addEventListener('click', () => {
        dom.xaelPopup.classList.add('hidden');
        const { gameState } = getState();
        if (gameState) {
            updateState('preChallengeGameStateSnapshot', structuredClone(gameState)); // Save game before challenge
            updateState('lastStoryGameOptions', { mode: gameState.gameMode, options: gameState.gameOptions });
            dom.storyModeModalEl.classList.remove('hidden');
            createCosmicGlowOverlay();
            renderStoryNode('xael_challenge_intro');
        }
    });

    dom.xaelStarPowerButton.addEventListener('click', () => {
        dom.xaelPowerConfirmModal.classList.remove('hidden');
    });

    dom.xaelPowerConfirmYes.addEventListener('click', () => {
        dom.xaelPowerConfirmModal.classList.add('hidden');
        const { gameState } = getState();
        if (!gameState || !gameState.isStoryMode) return;

        const player1 = gameState.players['player-1'];
        if (!player1 || !player1.hasXaelStarPower || player1.xaelStarPowerCooldown > 0) return;

        player1.xaelStarPowerCooldown = 3; // 3 rounds cooldown
        gameState.revealedHands = gameState.playerIdsInGame.filter(id => id !== 'player-1' && !gameState.players[id].isEliminated);
        announceEffect('REVELAÇÃO ESTELAR', 'reversus-total');
        sound.playSoundEffect('xael');
        updateLog("Poder Estelar ativado! Mãos dos oponentes reveladas por esta rodada.");
        renderAll();
    });

    dom.xaelPowerConfirmNo.addEventListener('click', () => {
        dom.xaelPowerConfirmModal.classList.add('hidden');
    });
}