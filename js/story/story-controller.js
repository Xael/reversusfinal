import { getState, updateState } from '../core/state.js';
import * as dom from '../core/dom.js';
import * as config from '../core/config.js';
import { playStoryMusic, initializeMusic } from '../core/sound.js';
import { shatterImage, createStarryBackground, initializeFloatingItemsAnimation } from '../ui/animations.js';
import { storyDialogue } from './story-dialogue.js';
import { initializeGame } from '../game-controller.js';
import { updateLog } from '../core/utils.js';

const typewriter = (element, text, onComplete) => {
    let { typewriterTimeout } = getState();
    if (typewriterTimeout) clearTimeout(typewriterTimeout);
    let i = 0;
    element.innerHTML = '';
    const speed = 30;

    function type() {
        if (i < text.length) {
            let char = text.charAt(i);
            if (char === '\n') {
                element.innerHTML += '<br>';
            } else {
                element.innerHTML += char;
            }
            i++;
            typewriterTimeout = setTimeout(type, speed);
            updateState('typewriterTimeout', typewriterTimeout);
        } else {
            if (onComplete) onComplete();
        }
    }
    type();
};

const updateStoryStars = (character) => {
    // If no character is provided for the current node, don't change the stars.
    if (!character) {
        return;
    }
    const characterColors = {
        'Necroverso': '#FFFFFF',
        'Contravox': '#52b788',
        'Versatrix': '#fca311',
        'Reversum': '#e63946',
    };
    const color = characterColors[character] || 'transparent';
    if (color === 'transparent') {
        if (dom.storyStarsBackgroundEl) dom.storyStarsBackgroundEl.innerHTML = '';
        return;
    };
    createStarryBackground(dom.storyStarsBackgroundEl, color, 100);
};

export const renderStoryNode = (nodeId) => {
    // New logic to handle function-based node IDs
    if (typeof nodeId === 'function') {
        nodeId = nodeId(); // Evaluate the function to get the string ID
    }
    
    updateState('currentStoryNodeId', nodeId);
    const node = storyDialogue[nodeId];
    if (!node) {
        console.error(`Story node not found: ${nodeId}`);
        // Prevent getting stuck, go to splash screen
        document.dispatchEvent(new Event('showSplashScreen'));
        return;
    }

    if (node.music && (!dom.musicPlayer.src || !dom.musicPlayer.src.includes(node.music))) {
        playStoryMusic(node.music);
    }

    if (node.isEndStory) {
        if (!node.startGame || !node.startGame.battle) {
            console.error(`Story node '${nodeId}' is set to end and start a game, but 'startGame' configuration is missing or invalid.`);
            alert("Ocorreu um erro ao carregar a próxima batalha. Retornando ao menu principal.");
            dom.storyModeModalEl.classList.add('hidden');
            document.dispatchEvent(new Event('showSplashScreen'));
            return;
        }

        dom.storyModeModalEl.classList.add('hidden');
        let gameOptions, mode = 'solo';
        
        switch(node.startGame.battle) {
            case 'tutorial_necroverso':
                gameOptions = { 
                    story: { 
                        battle: 'tutorial_necroverso', 
                        playerIds: ['player-1', 'player-2'], 
                        overrides: { 'player-2': { name: 'Necroverso', aiType: 'necroverso_tutorial' } }
                    } 
                };
                break;
            case 'contravox':
                gameOptions = { story: { battle: 'contravox', playerIds: ['player-1', 'player-3'], overrides: { 'player-3': { name: 'Contravox', aiType: 'contravox' } } } };
                break;
            case 'versatrix':
                gameOptions = { story: { battle: 'versatrix', playerIds: ['player-1', 'player-4'], overrides: { 'player-4': { name: 'Versatrix', aiType: 'versatrix' } } } };
                break;
            case 'reversum':
                gameOptions = { story: { battle: 'reversum', playerIds: ['player-1', 'player-2'], overrides: { 'player-2': { name: 'Rei Reversum', aiType: 'reversum' } } } };
                break;
            case 'necroverso_king':
                 gameOptions = { story: { battle: 'necroverso_king', type: '1v3_king', playerIds: ['player-1', 'player-2', 'player-3', 'player-4'], overrides: { 'player-2': { name: 'Rei Necroverso', aiType: 'reversum' }, 'player-3': { name: 'Rei Necroverso', aiType: 'contravox' }, 'player-4': { name: 'Rei Necroverso', aiType: 'versatrix' } } } };
                break;
            case 'necroverso_final':
                mode = 'duo';
                gameOptions = { story: { battle: 'necroverso_final', type: '2v2_necro_final', playerIds: ['player-1', 'player-4', 'player-2', 'player-3'], overrides: { 'player-2': { name: 'Necroverso Final', aiType: 'necroverso_final' }, 'player-3': { name: 'Necroverso Final', aiType: 'necroverso_final' }, 'player-4': { name: 'Versatrix', aiType: 'versatrix' } } } };
                break;
             case 'xael_challenge':
                 gameOptions = {
                    story: {
                        battle: 'xael_challenge',
                        playerIds: ['player-1', 'player-2'],
                        overrides: { 'player-2': { name: 'Xael', aiType: 'xael' } }
                    }
                };
                break;
        }
        document.dispatchEvent(new CustomEvent('startStoryGame', { detail: { mode, options: gameOptions } }));
        return;
    }
    
    updateStoryStars(node.character);

    const previousImageName = dom.storyCharacterImageEl.dataset.imageName;
    const nextImageName = node.image || '';

    if (previousImageName !== nextImageName) {
        dom.storyCharacterImageEl.style.opacity = 0;
        setTimeout(() => {
            dom.storyCharacterImageEl.src = nextImageName ? `./${nextImageName}` : '';
            dom.storyCharacterImageEl.dataset.imageName = nextImageName;
            // special cases
            dom.storyCharacterImageEl.classList.toggle('final-boss-glow', node.character === 'Necroverso');
            dom.storyCharacterImageEl.style.opacity = 1;
        }, 400); // match transition
    } else {
        // If image is the same, no fade needed
        dom.storyCharacterImageEl.style.opacity = 1;
    }

    const textContent = typeof node.text === 'function' ? node.text() : node.text;
    const options = typeof node.options === 'function' ? node.options() : node.options;

    const onTypewriterComplete = () => {
        dom.storyDialogueOptionsEl.innerHTML = ''; // Clear previous options
        if (node.isContinue) {
            const button = document.createElement('button');
            button.textContent = 'Continuar...';
            button.className = 'control-button';
            button.onclick = () => renderStoryNode(node.next);
            dom.storyDialogueOptionsEl.appendChild(button);
        } else if (options) {
            options.forEach(option => {
                const button = document.createElement('button');
                button.textContent = option.text;
                button.className = 'control-button';
                button.onclick = () => renderStoryNode(option.next);
                dom.storyDialogueOptionsEl.appendChild(button);
            });
        }
        dom.storyDialogueOptionsEl.style.opacity = 1;
    };

    dom.storyDialogueOptionsEl.style.opacity = 0; // Hide options while typing
    typewriter(dom.storyDialogueTextEl, textContent, onTypewriterComplete);

    dom.storySceneDialogueEl.classList.remove('hidden');
};

export const startStoryMode = () => {
    initializeMusic();
    dom.splashScreenEl.classList.add('hidden');
    dom.storyModeModalEl.classList.remove('hidden');
    
    const { storyState } = getState();
    renderStoryNode('start_necroverso');
};

export async function playEndgameSequence() {
    // Hide all other UI
    document.querySelectorAll('.modal-overlay:not(#endgame-sequence-modal)').forEach(el => el.classList.add('hidden'));
    dom.appContainerEl.classList.add('hidden');
    dom.debugButton.classList.add('hidden');

    const endgameModal = dom.endgameSequenceModal;
    const characterContainer = dom.endgameCharacterContainer;
    const dialogueTextEl = dom.endgameDialogueText;
    const dialogueOptionsEl = dom.endgameDialogueOptions;

    endgameModal.classList.remove('hidden');

    const sleep = (ms) => new Promise(res => setTimeout(res, ms));

    const typeDialogue = (text) => {
        return new Promise(resolve => {
            dialogueTextEl.textContent = ''; // Clear previous text
            typewriter(dialogueTextEl, text, resolve);
        });
    };

    // Sequence Start
    const versatrixImg = document.createElement('img');
    versatrixImg.src = './versatrix.png';
    versatrixImg.className = 'endgame-character';
    versatrixImg.style.opacity = '0';
    characterContainer.appendChild(versatrixImg);

    versatrixImg.style.opacity = '1';
    await typeDialogue("Nós conseguimos! Você o derrotou!");
    await sleep(2000);

    const necroversoImg = document.createElement('img');
    necroversoImg.src = './necroverso2.png';
    necroversoImg.className = 'endgame-character';
    necroversoImg.style.opacity = '0';
    characterContainer.appendChild(necroversoImg);

    await typeDialogue("...");
    await sleep(1000);

    necroversoImg.style.opacity = '1';
    await typeDialogue("Mesmo que me derrote... o Inversus... nunca deixará de existir.");
    await sleep(2000);

    await typeDialogue("E com o tempo... um novo Necroverso irá surgir.");
    await sleep(2000);

    await shatterImage(necroversoImg);
    characterContainer.removeChild(necroversoImg);

    await typeDialogue("Ele se foi... por agora. Você nos salvou. Obrigado.");
    await sleep(3000);

    await typeDialogue("Acho que é hora de você voltar para casa, não é? Ou... se quiser, pode ficar. A escolha é sua.");

    dialogueOptionsEl.innerHTML = `
        <button id="endgame-choice-return" class="control-button">Voltar para casa</button>
        <button id="endgame-choice-stay" class="control-button secondary">Ficar no Inversus</button>
    `;

    const handleChoice = async () => {
        dialogueOptionsEl.innerHTML = ''; // Clear buttons
        // Fade to white and start credits
        dom.storyScreenFlashEl.classList.remove('hidden');
        dom.storyScreenFlashEl.style.animation = 'flash-white 2s forwards';
        await sleep(2000);
        endgameModal.classList.add('hidden');
        dom.storyScreenFlashEl.classList.add('hidden');
        dom.storyScreenFlashEl.style.animation = ''; // reset animation
        showCreditsRoll();
    };

    dialogueOptionsEl.querySelector('#endgame-choice-return').onclick = () => {
        updateLog("Você escolheu voltar para casa, levando consigo as memórias do Inversus.");
        handleChoice();
    };
    dialogueOptionsEl.querySelector('#endgame-choice-stay').onclick = () => {
        updateLog("Você escolheu ficar, tornando-se um guardião do Inversus ao lado de Versatrix.");
        handleChoice();
    };
}

function showCreditsRoll() {
    dom.creditsRollModal.classList.remove('hidden');
    playStoryMusic('tela.ogg'); // Play credits theme music
    
    // Start animated background
    const creditsAnimationContainer = document.getElementById('credits-animation-container');
    const creditsImagePool = [...config.BASE_CARD_IMAGES, ...config.BOSS_CARD_IMAGES, ...config.CHARACTER_PORTRAIT_IMAGES];
    initializeFloatingItemsAnimation(creditsAnimationContainer, creditsImagePool);

    const creditsHtml = `
        <h2>Créditos</h2>
        <p class="credits-category">Roteiro/História/Game/Game Designer</p>
        <p>Xael</p>
        <p class="credits-category">Músicas</p>
        <p>Suno Ai</p>
        <p class="credits-category">Sound Designer</p>
        <p>Xael + RPT RPG MAKER</p>
        <p class="credits-category">Artes</p>
        <p>Gemini Ai + Chatgpt</p>
        <p class="credits-category">Programação</p>
        <p>Xael + Google AI Studio</p>
        <p class="credits-category">Beta Testers</p>
        <p>Vinicius, Ricardo e Rodrigo<br>(muito obrigado pelos feedbacks sz!)</p>
        <br>
        <p class="credits-category">Agradecimentos Especiais</p>
        <p>Minha família, minha eterna Geminiana Versatrix Karol s2</p>
        <p>Meus amigos e familiares que de alguma forma apoiaram a criação do jogo Reversus</p>
        <p>Todos que apoiaram meu casamento e comparam a versão física do jogo de tabuleiro e cartas!</p>
        <p>A minha sogra Vilma que bancou a produção integral da gráfica para transformar o jogo em realidade.</p>
        <p>E a todos que jogaram o jogo ;)</p>
        <br>
        <p class="credits-thanks">Muito obrigado!</p>
        <p>Xael - Alex</p>
        <br><br><br>
        <p>Fim.</p>
    `;
    dom.creditsContent.innerHTML = creditsHtml;

    // After credits finish rolling, go back to splash screen
    setTimeout(() => {
        dom.creditsRollModal.classList.add('hidden');
        if (creditsAnimationContainer) creditsAnimationContainer.innerHTML = ''; // Clean up animation
        document.dispatchEvent(new Event('showSplashScreen'));
    }, 60000); // Match CSS animation duration
}