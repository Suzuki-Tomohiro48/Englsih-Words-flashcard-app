// GASをウェブアプリとしてデプロイした「/exec」で終わるURLを貼り付ける
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwN3T3RuOb5YkBov_bpPvnFOHFoDxss3cuXsaM-xbNWzHMFWsyGxg7_ISlBDY57oKRI/exec',
  TOKEN: '', // コード.gs の TOKEN と同じ値（使わないなら空）

  NEW_PER_DAY: 20,        // 1日の新規単語の上限
  REVIEW_PER_DAY: 20,     // 1日の復習の上限
  DAILY_GOAL_WORDS: 20,   // 統計画面の「今日の目標」(回答した語数)
  DAY_START_HOUR: 4       // 1日の区切り（午前4時）。コード.gs の DAY_START_HOUR と合わせる
};
