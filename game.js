/* =================================================
 * 4. GUI 控制器 (TicTacToeGUI)
 * ================================================= */

// 等待 HTML DOM 載入完成
document.addEventListener('DOMContentLoaded', () => {

    // --- 核心狀態變數 ---
    let state = new TicTacToeState();
    let gameOver = false;
    let gameMode = null; // 'PvP', 'PvC', 'CvC'
    let playerXType = null;
    let playerOType = null;
    const agentX = new MCTSAgent(1000);
    const agentO = new MCTSAgent(1000);

    const difficultyLevels = {
        "簡單": 50,
        "中等": 500,
        "困難": 2000
    };

    // --- 獲取 DOM 元素 ---
    const statusLabel = document.getElementById('status-label');
    const modeFrame = document.getElementById('mode-frame');
    const pvcSetupFrame = document.getElementById('pvc-setup-frame');
    const cvcSetupFrame = document.getElementById('cvc-setup-frame');
    const boardFrame = document.getElementById('board-frame');
    const restartButton = document.getElementById('restart-button');
    const boardButtons = [];

    // --- 初始化棋盤按鈕 ---
    for (let i = 0; i < 9; i++) {
        const button = document.createElement('button');
        button.classList.add('cell');
        button.dataset.index = i; // 儲存索引
        button.disabled = true;
        button.addEventListener('click', () => onCellClick(i));
        boardFrame.appendChild(button);
        boardButtons.push(button);
    }

    // --- 模式選擇事件 ---
    document.getElementById('btn-pvp').addEventListener('click', () => setupMode('PvP'));
    document.getElementById('btn-pvc').addEventListener('click', () => setupMode('PvC'));
    document.getElementById('btn-cvc').addEventListener('click', () => setupMode('CvC'));

    function setupMode(mode) {
        gameMode = mode;
        modeFrame.style.display = 'none';

        if (mode === 'PvP') {
            playerXType = 'human';
            playerOType = 'human';
            startGame();
        } else if (mode === 'PvC') {
            pvcSetupFrame.style.display = 'block';
            statusLabel.textContent = "請選擇難度與角色";
        } else if (mode === 'CvC') {
            cvcSetupFrame.style.display = 'block';
            statusLabel.textContent = "請設定 AI 難度";
        }
    }

    // --- PvC 設定事件 ---
    document.getElementById('btn-pvc-x').addEventListener('click', () => startPvCGame('X'));
    document.getElementById('btn-pvc-o').addEventListener('click', () => startPvCGame('O'));

    function startPvCGame(humanPlayerSymbol) {
        pvcSetupFrame.style.display = 'none';
        const difficulty = document.querySelector('input[name="pvc-difficulty"]:checked').value;
        const iterations = difficultyLevels[difficulty];

        if (humanPlayerSymbol === 'X') {
            playerXType = 'human';
            playerOType = 'ai';
            agentO.iterations = iterations;
            statusLabel.textContent = `難度: ${difficulty} | 玩家 (X) 的回合`;
        } else {
            playerXType = 'ai';
            playerOType = 'human';
            agentX.iterations = iterations;
            statusLabel.textContent = `難度: ${difficulty} | AI (X) 的回合`;
        }
        startGame();
    }
    
    // --- CvC 設定事件 ---
    document.getElementById('btn-cvc-start').addEventListener('click', startCvCGame);

    function startCvCGame() {
        cvcSetupFrame.style.display = 'none';
        const xDiff = document.querySelector('input[name="cvc-x-difficulty"]:checked').value;
        const oDiff = document.querySelector('input[name="cvc-o-difficulty"]:checked').value;

        agentX.iterations = difficultyLevels[xDiff];
        agentO.iterations = difficultyLevels[oDiff];
        playerXType = 'ai';
        playerOType = 'ai';
        statusLabel.textContent = `AI (X) ${xDiff} vs AI (O) ${oDiff}`;
        startGame();
    }

    // --- 遊戲核心邏輯 ---
    function startGame() {
        gameOver = false;
        handleTurn();
    }

    function handleTurn() {
        if (gameOver) return;

        const player = state.playerToMove;
        const playerType = (player === 'X') ? playerXType : playerOType;

        // 更新標籤
        updateStatusLabel();
        
        if (playerType === 'human') {
            // 啟用空格子
            updateBoard();
        } else {
            // 禁用所有格子並呼叫 AI
            boardButtons.forEach(btn => btn.disabled = true);
            
            // **** 解決 "卡住" 問題 ****
            // 使用 setTimeout(..., 50) 來將 AI 計算推遲到 "下一個事件迴圈"
            // 這讓瀏覽器有時間重繪 "思考中..." 的標籤，避免凍結
            // 這就是 Python/Tkinter 中 threading + queue 的網頁版簡易替代方案
            setTimeout(aiTurn, 50); 
        }
    }

    function onCellClick(index) {
        if (gameOver) return;
        const player = state.playerToMove;
        const playerType = (player === 'X') ? playerXType : playerOType;

        if (playerType !== 'human' || state.board[index] !== ' ') {
            return;
        }

        state = state.makeMove(index);
        updateBoard();

        if (checkGameOver()) return;
        handleTurn();
    }

    function aiTurn() {
        if (gameOver) return;
        
        const player = state.playerToMove;
        const agent = (player === 'X') ? agentX : agentO;
        
        // ** AI 計算 **
        const move = agent.findBestMove(state);
        
        state = state.makeMove(move);
        updateBoard();

        if (checkGameOver()) return;
        handleTurn();
    }

    // --- 輔助函式 ---
    function updateBoard() {
        const isHumanTurn = (state.playerToMove === 'X' && playerXType === 'human') ||
                            (state.playerToMove === 'O' && playerOType === 'human');

        for (let i = 0; i < 9; i++) {
            boardButtons[i].textContent = state.board[i];
            
            // 禁用已下過的，或在 AI 回合時禁用所有
            if (state.board[i] !== ' ' || !isHumanTurn || gameOver) {
                boardButtons[i].disabled = true;
            } else {
                boardButtons[i].disabled = false;
            }
        }
    }

    function updateStatusLabel() {
        const player = state.playerToMove;
        const playerType = (player === 'X') ? playerXType : playerOType;

        if (gameMode === 'PvP') {
            statusLabel.textContent = `玩家 (${player}) 的回合`;
        } else if (gameMode === 'PvC') {
            const difficulty = document.querySelector('input[name="pvc-difficulty"]:checked').value;
            if (playerType === 'human') {
                statusLabel.textContent = `難度: ${difficulty} | 輪到你了 (${player})`;
            } else {
                statusLabel.textContent = `難度: ${difficulty} | AI (${player}) 正在思考...`;
            }
        } else if (gameMode === 'CvC') {
            const xDiff = document.querySelector('input[name="cvc-x-difficulty"]:checked').value;
            const oDiff = document.querySelector('input[name="cvc-o-difficulty"]:checked').value;
            statusLabel.textContent = `AI (X:${xDiff}) vs AI (O:${oDiff}) | AI (${player}) 思考中...`;
        }
    }

    function checkGameOver() {
        if (state.isTerminal()) {
            gameOver = true;
            boardButtons.forEach(btn => btn.disabled = true); // 禁用所有按鈕

            let message = "";
            if (state.winner === 'draw') {
                message = "🤝 平局！ 🤝";
            } else {
                message = `🎉 玩家 ${state.winner} 獲勝！ 🎉`;
            }
            statusLabel.textContent = "遊戲結束！";
            
            // 使用 setTimeout 確保標籤更新後再彈窗
            setTimeout(() => {
                alert(message);
            }, 100);
            
            return true;
        }
        return false;
    }

    // --- 重新開始 ---
    restartButton.addEventListener('click', restartGame);

    function restartGame() {
        state = new TicTacToeState();
        gameOver = false;
        gameMode = null;
        playerXType = null;
        playerOType = null;

        // 隱藏設定畫面
        pvcSetupFrame.style.display = 'none';
        cvcSetupFrame.style.display = 'none';
        
        // 顯示主選單
        modeFrame.style.display = 'flex';
        statusLabel.textContent = "歡迎！請選擇遊戲模式";
        
        // 重置棋盤
        boardButtons.forEach(btn => {
            btn.textContent = ' ';
            btn.disabled = true;
        });
    }

}); // DOMContentLoaded 結束
