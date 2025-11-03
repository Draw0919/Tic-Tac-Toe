// mcts_worker.js

// 1. 在 Worker 執行緒中，導入 MCTS 核心邏輯
//    (注意：mcts.js 檔案本身不需要修改)
importScripts('mcts.js');

// 2. 建立一個 AI 代理人實例
//    (這個 agent 活在 Worker 執行緒中)
const agent = new MCTSAgent();

// 3. 監聽來自主執行緒 (game.js) 的訊息
self.onmessage = function(e) {
    // e.data 包含了主執行緒發送的資料
    const { stateData, iterations } = e.data;

    // 將收到的 "純資料" 轉換回 MCTS 遊戲狀態
    const state = new TicTacToeState(stateData.board, stateData.playerToMove);

    // 4. 設定 AI 難度
    agent.iterations = iterations;

    // 5. 執行耗時的 MCTS 運算 (這會凍結 Worker，但不會凍結 GUI)
    const move = agent.findBestMove(state);

    // 6. 運算完成後，將結果 (move) 發送回主執行緒
    self.postMessage(move);
};