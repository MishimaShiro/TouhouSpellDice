/**
 * 東方スペルカード抽選Webアプリケーション
 * app.js (Refactored & Architecture Upgraded)
 * 
 * ==========================================================================
 * 責務構成 (Architecture & Responsibilities):
 * 1. Constants & Configuration (定数・マスター定義・ソート設定)
 * 2. Pure Business Logic: SpellFilterEngine (純粋関数型フィルタリングエンジン)
 * 3. Pure Business Logic: GameDeckManager (純粋ロジック山札・進行ステートマシン)
 * 4. Application Store: AppStore (単一情報源・単方向データフロー・状態カプセル化)
 * 5. DOM Cache (DOM要素参照の集約キャッシュ)
 * 6. UI Renderer: ViewRenderer (UI描画・アクセシビリティ・差分更新)
 * 7. Data Service: DataService (CSV読込・文字コード自動判別・スキーマバリデーション)
 * 8. Game Controller: GameController (進行オーケストレーション)
 * 9. Event Handlers & Application Bootstrap (イベント登録・高階関数・起動)
 * ==========================================================================
 */

// ==========================================================================
// 1. Constants & Configuration (定数・マスター定義・ソート設定)
// ==========================================================================

/**
 * 東方Project全18作品の分類定義
 */
const WORK_CATEGORIES = {
  INTEGER: ['th06', 'th07', 'th08', 'th10', 'th11', 'th12', 'th13', 'th14', 'th15', 'th16', 'th17', 'th18', 'th20'],
  FAIRY: ['th12.8'],
  GAIDEN: ['th09.5', 'th12.5', 'th14.3', 'th16.5']
};

/**
 * 難易度の基本表示ソート順
 */
const DIFFICULTY_ORDER = [
  'Easy',
  'Normal',
  'Hard',
  'Lunatic',
  'Extra',
  'Phantasm',
  'Last Word',
  'OverDrive',
  'なし (撮影・外伝系)'
];

/**
 * ステージ自然順ソート用の優先度定数（マジックナンバーの排除）
 */
const STAGE_SORT_PRIORITY = {
  STAGE_NUMBER_MULTIPLIER: 10,
  STAGE_EX: 100,
  STAGE_PH: 110,
  ROUTE_A_BASE: 200,
  ROUTE_B_BASE: 300,
  ROUTE_C_BASE: 400,
  DEFAULT: 500
};

/**
 * CSVスキーマ検証用必須カラム定義
 */
const REQUIRED_CSV_FIELDS = {
  WORK: ['WorkId', 'work_id', 'Work', 'work'],
  NAME: ['Name', 'name', 'SpellName', 'spell_name', 'Spell', 'spell']
};

// ==========================================================================
// 2. Pure Business Logic: SpellFilterEngine (純粋関数型フィルタリングエンジン)
// ==========================================================================
/**
 * DOM（document/window）に一切依存しない純粋なビジネスロジックモジュール。
 * 単体テスト可能。
 */
const SpellFilterEngine = {
  /**
   * 選択中の作品群が撮影・外伝系のみかどうかを判定
   * @param {Set<string>|Array<string>} selectedWorks
   * @returns {boolean}
   */
  isOnlyGaidenSelected(selectedWorks) {
    if (!selectedWorks || (selectedWorks instanceof Set ? selectedWorks.size === 0 : selectedWorks.length === 0)) {
      return false;
    }
    for (const wid of selectedWorks) {
      if (WORK_CATEGORIES.INTEGER.includes(wid) || WORK_CATEGORIES.FAIRY.includes(wid)) {
        return false;
      }
    }
    return true;
  },

  /**
   * ステージソート用の優先度スコア計算（自然順ソート）
   * @param {string} stage
   * @returns {number}
   */
  getStageSortScore(stage) {
    if (!stage) return STAGE_SORT_PRIORITY.DEFAULT;
    if (/^\d+$/.test(stage)) {
      return parseInt(stage, 10) * STAGE_SORT_PRIORITY.STAGE_NUMBER_MULTIPLIER;
    }
    if (/^\d+[A-Z]$/.test(stage)) {
      const num = parseInt(stage, 10) * STAGE_SORT_PRIORITY.STAGE_NUMBER_MULTIPLIER;
      const sub = stage.charCodeAt(stage.length - 1) - 64; // A=1, B=2, ...
      return num + sub;
    }
    if (stage === 'Ex') return STAGE_SORT_PRIORITY.STAGE_EX;
    if (stage === 'Ph') return STAGE_SORT_PRIORITY.STAGE_PH;
    if (stage.startsWith('A')) return STAGE_SORT_PRIORITY.ROUTE_A_BASE + (stage.charCodeAt(1) || 0);
    if (stage.startsWith('B')) return STAGE_SORT_PRIORITY.ROUTE_B_BASE + (stage.charCodeAt(1) || 0);
    if (stage.startsWith('C')) return STAGE_SORT_PRIORITY.ROUTE_C_BASE + (stage.charCodeAt(1) || 0);
    return STAGE_SORT_PRIORITY.DEFAULT;
  },

  /**
   * ステージ表示ラベルのフォーマット
   * @param {string} stage
   * @returns {string}
   */
  formatStageLabel(stage) {
    if (!stage) return 'ステージなし';
    if (stage === 'Ex') return 'Stage Extra';
    if (stage === 'Ph') return 'Stage Phantasm';
    if (stage === 'OD') return 'OverDrive';
    if (stage === 'LW') return 'Last Word';
    return `Stage ${stage}`;
  },

  /**
   * 選択された作品群に含まれる有効ステージ一覧を抽出してソート
   * @param {Array<Object>} cards
   * @param {Set<string>} selectedWorks
   * @returns {Array<string>}
   */
  extractAvailableStages(cards, selectedWorks) {
    if (!cards || !selectedWorks || selectedWorks.size === 0) return [];

    const stageSet = new Set();
    cards.forEach(card => {
      if (selectedWorks.has(card.workId)) {
        if (card.stage && card.stage !== 'LW' && card.stage !== 'OD') {
          stageSet.add(card.stage);
        }
      }
    });

    return Array.from(stageSet).sort((a, b) => this.getStageSortScore(a) - this.getStageSortScore(b));
  },

  /**
   * 単一カードが指定条件（criteria）に一致するかどうかを判定
   * @param {Object} card
   * @param {Object} criteria
   * @returns {boolean}
   */
  matches(card, criteria) {
    const {
      selectedWorks,
      selectedDifficulties,
      selectedStages,
      selectedCharacter = '',
      survivalFilter = 'both',
      finalFilter = 'both',
      isOnlyGaiden = false
    } = criteria;

    // 1. 作品一致判定
    if (!selectedWorks || !selectedWorks.has(card.workId)) {
      return false;
    }

    // 2. キャラクター一致判定
    if (selectedCharacter && card.character !== selectedCharacter) {
      return false;
    }

    // 3. 耐久スペル判定
    if (survivalFilter === 'normal' && card.isSurvival) return false;
    if (survivalFilter === 'survival' && !card.isSurvival) return false;

    // 4. Finalスペル判定
    if (finalFilter === 'normal' && card.isFinal) return false;
    if (finalFilter === 'final' && !card.isFinal) return false;

    // 5. Last Word 例外判定 (永夜抄: 難易度Last Word選択時、ステージ条件不問で通過)
    const isLastWord = card.difficulty === 'Last Word' || card.stage === 'LW';
    if (isLastWord) {
      return selectedDifficulties ? selectedDifficulties.has('Last Word') : false;
    }

    // 6. OverDrive 例外判定 (神霊廟: 難易度OverDrive選択時、ステージ条件不問で通過)
    const isOverDrive = card.difficulty === 'OverDrive' || card.stage === 'OD';
    if (isOverDrive) {
      return selectedDifficulties ? selectedDifficulties.has('OverDrive') : false;
    }

    // 7. 難易度判定 (撮影・外伝等の「なし」含む)
    const isBlankDiff = card.difficulty === 'なし (撮影・外伝系)' || !card.difficulty;
    if (isBlankDiff) {
      if (!isOnlyGaiden && (!selectedDifficulties || !selectedDifficulties.has('なし (撮影・外伝系)'))) {
        return false;
      }
    } else {
      if (!selectedDifficulties || !selectedDifficulties.has(card.difficulty)) {
        return false;
      }
    }

    // 8. ステージ判定 (ステージ未設定、または外伝単独選択時はバイパス)
    if (!card.stage || isOnlyGaiden) {
      return true;
    }

    return selectedStages ? selectedStages.has(card.stage) : false;
  },

  /**
   * カード一覧から条件に合致するプールを抽出
   * @param {Array<Object>} cards
   * @param {Object} criteria
   * @returns {Array<Object>}
   */
  filterPool(cards, criteria) {
    if (!cards || cards.length === 0 || !criteria || !criteria.selectedWorks || criteria.selectedWorks.size === 0) {
      return [];
    }

    const onlyGaiden = criteria.isOnlyGaiden !== undefined
      ? criteria.isOnlyGaiden
      : this.isOnlyGaidenSelected(criteria.selectedWorks);

    // バリデーション: 外伝単独以外で難易度未選択なら0件
    if (!onlyGaiden && (!criteria.selectedDifficulties || criteria.selectedDifficulties.size === 0)) {
      return [];
    }

    // バリデーション: 外伝単独以外で、ステージ候補が存在するにもかかわらず未選択なら0件
    if (!onlyGaiden && criteria.availableStages && criteria.availableStages.length > 0 && (!criteria.selectedStages || criteria.selectedStages.size === 0)) {
      return [];
    }

    const effectiveCriteria = { ...criteria, isOnlyGaiden: onlyGaiden };
    return cards.filter(card => this.matches(card, effectiveCriteria));
  }
};

// ==========================================================================
// 3. Pure Business Logic: GameDeckManager (山札・進行管理・DOM非依存)
// ==========================================================================
/**
 * 山札・挑戦状態・履歴・除外カードの管理を行うステートマシン。
 * DOM操作は行わず、操作結果のオブジェクトを返す。
 */
class GameDeckManager {
  constructor() {
    this._deck = [];
    this._history = [];
    this._removedCards = [];
    this._currentCard = null;
    this._challengeState = 'none'; // 'none' | 'pending' | 'captured' | 'failed'
    this._passUsedForCurrent = false;
    this._isActive = false;
  }

  get deck() { return this._deck; }
  get history() { return this._history; }
  get removedCards() { return this._removedCards; }
  get currentCard() { return this._currentCard; }
  get challengeState() { return this._challengeState; }
  get passUsedForCurrent() { return this._passUsedForCurrent; }
  get isActive() { return this._isActive; }

  /**
   * ゲーム開始
   * @param {Array<Object>} allCards
   * @returns {Object}
   */
  start(allCards) {
    if (!allCards || allCards.length === 0) {
      return { success: false, reason: 'no_cards' };
    }
    this._deck = [...allCards];
    this._history = [];
    this._removedCards = [];
    this._currentCard = null;
    this._challengeState = 'none';
    this._passUsedForCurrent = false;
    this._isActive = true;

    return {
      success: true,
      deckCount: this._deck.length
    };
  }

  /**
   * ゲーム終了
   * @returns {Object}
   */
  end() {
    this._isActive = false;
    this._currentCard = null;
    this._challengeState = 'none';
    this._passUsedForCurrent = false;
    this._deck = [];

    return { success: true };
  }

  /**
   * スペルカード抽選（山札から1枚消費）
   * @param {Object} criteria
   * @returns {Object}
   */
  draw(criteria) {
    if (!this._isActive) {
      return { success: false, reason: 'not_active' };
    }
    if (this._challengeState === 'pending') {
      return { success: false, reason: 'pending_challenge' };
    }

    const candidates = SpellFilterEngine.filterPool(this._deck, criteria);
    if (candidates.length === 0) {
      return { success: false, reason: 'empty_pool', candidatesCount: 0 };
    }

    // ランダム選出
    const randomIndex = Math.floor(Math.random() * candidates.length);
    const pickedCard = candidates[randomIndex];

    // 山札から消費
    this._deck = this._deck.filter(c => c.id !== pickedCard.id);
    this._currentCard = pickedCard;
    this._challengeState = 'pending';
    this._passUsedForCurrent = false;

    // 履歴アイテム生成（挑戦中）
    const historyItem = {
      id: pickedCard.id,
      workId: pickedCard.workId,
      workName: pickedCard.workName,
      spellNo: pickedCard.spellNo,
      stage: pickedCard.stage,
      character: pickedCard.character,
      difficulty: pickedCard.difficulty,
      name: pickedCard.name,
      isSurvival: pickedCard.isSurvival,
      isFinal: pickedCard.isFinal,
      status: 'pending',
      timestamp: new Date()
    };
    this._history.unshift(historyItem);

    return {
      success: true,
      card: pickedCard,
      historyItem,
      deckCount: this._deck.length
    };
  }

  /**
   * 挑戦結果の記録（取得成功 / 取得失敗）
   * @param {boolean} isSuccess
   * @returns {Object}
   */
  recordResult(isSuccess) {
    if (!this._currentCard || this._challengeState !== 'pending') {
      return { success: false, reason: 'invalid_state' };
    }

    this._challengeState = isSuccess ? 'captured' : 'failed';
    let updatedHistoryItem = null;

    if (this._history.length > 0 && this._history[0].id === this._currentCard.id) {
      this._history[0].status = this._challengeState;
      updatedHistoryItem = this._history[0];
    }

    return {
      success: true,
      result: this._challengeState,
      updatedHistoryItem,
      card: this._currentCard
    };
  }

  /**
   * パス（引き直し）処理（1回制限）
   * @param {Object} criteria
   * @returns {Object}
   */
  pass(criteria) {
    if (!this._currentCard || this._challengeState !== 'pending' || this._passUsedForCurrent) {
      return { success: false, reason: 'invalid_state' };
    }

    const candidates = SpellFilterEngine.filterPool(this._deck, criteria);
    if (candidates.length === 0) {
      return { success: false, reason: 'empty_pool' };
    }

    // 直前カードの履歴を passed に更新
    let passedHistoryItem = null;
    if (this._history.length > 0 && this._history[0].id === this._currentCard.id) {
      this._history[0].status = 'passed';
      passedHistoryItem = this._history[0];
    }

    // 次のカードを選出
    const randomIndex = Math.floor(Math.random() * candidates.length);
    const nextCard = candidates[randomIndex];

    this._deck = this._deck.filter(c => c.id !== nextCard.id);
    this._currentCard = nextCard;
    this._challengeState = 'pending';
    this._passUsedForCurrent = true;

    // 新カードの履歴追加
    const newHistoryItem = {
      id: nextCard.id,
      workId: nextCard.workId,
      workName: nextCard.workName,
      spellNo: nextCard.spellNo,
      stage: nextCard.stage,
      character: nextCard.character,
      difficulty: nextCard.difficulty,
      name: nextCard.name,
      isSurvival: nextCard.isSurvival,
      isFinal: nextCard.isFinal,
      status: 'pending',
      timestamp: new Date()
    };
    this._history.unshift(newHistoryItem);

    return {
      success: true,
      card: nextCard,
      newHistoryItem,
      passedHistoryItem,
      deckCount: this._deck.length
    };
  }

  /**
   * リストから削除（山札から永久除外）
   * @returns {Object}
   */
  removeCurrent() {
    if (!this._currentCard) {
      return { success: false, reason: 'no_current_card' };
    }

    const cardToRemove = this._currentCard;
    this._deck = this._deck.filter(c => c.id !== cardToRemove.id);
    this._removedCards.unshift(cardToRemove);

    let updatedHistoryItem = null;
    if (this._history.length > 0 && this._history[0].id === cardToRemove.id && this._history[0].status === 'pending') {
      this._history[0].status = 'passed';
      updatedHistoryItem = this._history[0];
    }

    this._currentCard = null;
    this._challengeState = 'none';
    this._passUsedForCurrent = false;

    return {
      success: true,
      removedCard: cardToRemove,
      updatedHistoryItem,
      deckCount: this._deck.length
    };
  }
}

// ==========================================================================
// 4. Application Store: AppStore (単一情報源・状態カプセル化)
// ==========================================================================
/**
 * 状態の一元管理を行うストア。
 * 直接書き換えを禁止し、setState / アクション経由で更新してリスナーに通知する。
 */
class AppStore {
  constructor() {
    this._deckManager = new GameDeckManager();
    this._state = {
      // マスターデータ
      allCards: [],
      worksList: [],
      availableDifficulties: [],
      availableStages: [],
      allCharacters: [],
      hasSurvivalColumn: false,
      hasFinalColumn: false,

      // フィルター条件
      selectedWorks: new Set(),
      selectedDifficulties: new Set(),
      selectedStages: new Set(),
      selectedCharacter: '',
      survivalFilter: 'both', // 'both' | 'normal' | 'survival'
      finalFilter: 'both'     // 'both' | 'normal' | 'final'
    };
    this._listeners = new Set();
  }

  get deckManager() {
    return this._deckManager;
  }

  /**
   * 現在の状態の浅いコピーを取得（直接代入防止）
   * @returns {Object}
   */
  getState() {
    return { ...this._state };
  }

  /**
   * フィルター判定用の Criteria オブジェクトを取得
   * @returns {Object}
   */
  getCriteria() {
    return {
      selectedWorks: this._state.selectedWorks,
      selectedDifficulties: this._state.selectedDifficulties,
      selectedStages: this._state.selectedStages,
      selectedCharacter: this._state.selectedCharacter,
      survivalFilter: this._state.survivalFilter,
      finalFilter: this._state.finalFilter,
      availableStages: this._state.availableStages,
      isOnlyGaiden: SpellFilterEngine.isOnlyGaidenSelected(this._state.selectedWorks)
    };
  }

  /**
   * 状態の更新と変更通知
   * @param {Object} partialState
   */
  setState(partialState) {
    const prevState = { ...this._state };
    this._state = { ...this._state, ...partialState };
    const changedKeys = Object.keys(partialState);
    this._notify(this._state, prevState, changedKeys);
  }

  /**
   * 状態変更リスナーの購読
   * @param {Function} listener (newState, prevState, changedKeys) => void
   * @returns {Function} unregister
   */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify(newState, prevState, changedKeys) {
    this._listeners.forEach(fn => {
      try {
        fn(newState, prevState, changedKeys);
      } catch (err) {
        console.error('AppStore listener notification error:', err);
      }
    });
  }

  // アクションメソッド群
  setMasterData(payload) {
    this.setState({
      allCards: payload.allCards,
      worksList: payload.worksList,
      availableDifficulties: payload.availableDifficulties,
      availableStages: payload.availableStages,
      allCharacters: payload.allCharacters,
      hasSurvivalColumn: payload.hasSurvivalColumn,
      hasFinalColumn: payload.hasFinalColumn,
      selectedWorks: new Set(payload.selectedWorks),
      selectedDifficulties: new Set(payload.selectedDifficulties),
      selectedStages: new Set(payload.selectedStages),
      selectedCharacter: '',
      survivalFilter: 'both',
      finalFilter: 'both'
    });
  }

  updateWorks(worksSet, preserveStageSelection = true) {
    const availableStages = SpellFilterEngine.extractAvailableStages(this._state.allCards, worksSet);
    let selectedStages;

    if (preserveStageSelection) {
      selectedStages = new Set();
      this._state.selectedStages.forEach(st => {
        if (availableStages.includes(st)) selectedStages.add(st);
      });
      if (selectedStages.size === 0 && availableStages.length > 0) {
        availableStages.forEach(st => selectedStages.add(st));
      }
    } else {
      selectedStages = new Set(availableStages);
    }

    this.setState({
      selectedWorks: new Set(worksSet),
      availableStages,
      selectedStages
    });
  }

  updateDifficulties(diffsSet) {
    this.setState({ selectedDifficulties: new Set(diffsSet) });
  }

  updateStages(stagesSet) {
    this.setState({ selectedStages: new Set(stagesSet) });
  }

  setCharacter(char) {
    this.setState({ selectedCharacter: char });
  }

  setSurvivalFilter(value) {
    this.setState({ survivalFilter: value });
  }

  setFinalFilter(value) {
    this.setState({ finalFilter: value });
  }

  applyPreset(presetType) {
    if (this._state.allCards.length === 0) return;

    let selectedWorks;
    let selectedDifficulties;
    let selectedCharacter = '';
    let survivalFilter = 'both';
    let finalFilter = 'both';

    switch (presetType) {
      case 'main-normal':
        selectedWorks = new Set(WORK_CATEGORIES.INTEGER);
        selectedDifficulties = new Set(['Normal']);
        break;
      case 'extra-phantasm':
        selectedWorks = new Set(WORK_CATEGORIES.INTEGER);
        selectedDifficulties = new Set(['Extra', 'Phantasm']);
        break;
      case 'survival':
        selectedWorks = new Set(this._state.worksList.map(w => w.workId));
        selectedDifficulties = new Set(this._state.availableDifficulties);
        survivalFilter = 'survival';
        break;
      case 'th08':
        selectedWorks = new Set(['th08']);
        selectedDifficulties = new Set(this._state.availableDifficulties);
        break;
      case 'th128':
        selectedWorks = new Set(['th12.8']);
        selectedDifficulties = new Set(this._state.availableDifficulties);
        break;
      case 'reset':
      default:
        selectedWorks = new Set(this._state.worksList.map(w => w.workId));
        selectedDifficulties = new Set(this._state.availableDifficulties);
        break;
    }

    const availableStages = SpellFilterEngine.extractAvailableStages(this._state.allCards, selectedWorks);
    const selectedStages = new Set(availableStages);

    this.setState({
      selectedWorks,
      selectedDifficulties,
      availableStages,
      selectedStages,
      selectedCharacter,
      survivalFilter,
      finalFilter
    });
  }
}

// ストアのインスタンス生成
const appStore = new AppStore();

// ==========================================================================
// 5. DOM Cache (DOM要素参照の集約キャッシュ)
// ==========================================================================
const DOM = {
  // ステータス関連
  dataStatusBadge: document.getElementById('data-status-badge'),
  csvFileInput: document.getElementById('csv-file-input'),
  gameStatusText: document.getElementById('game-status-text'),
  filteredCount: document.getElementById('filtered-count'),
  deckCount: document.getElementById('deck-count'),
  totalCount: document.getElementById('total-count'),
  notificationBar: document.getElementById('notification-bar'),

  // プリセットボタン
  presetButtons: document.querySelectorAll('.btn-preset'),

  // 作品選択関連
  workOptionsInteger: document.getElementById('work-options-integer'),
  workOptionsFairy: document.getElementById('work-options-fairy'),
  workOptionsGaiden: document.getElementById('work-options-gaiden'),
  workWarning: document.getElementById('work-warning'),
  btnWorkAll: document.getElementById('btn-work-all'),
  btnWorkNone: document.getElementById('btn-work-none'),
  btnWorkIntegerAll: document.getElementById('btn-work-integer-all'),
  btnWorkIntegerNone: document.getElementById('btn-work-integer-none'),
  btnWorkFairyToggle: document.getElementById('btn-work-fairy-toggle'),
  btnWorkGaidenAll: document.getElementById('btn-work-gaiden-all'),
  btnWorkGaidenNone: document.getElementById('btn-work-gaiden-none'),

  // 難易度関連
  difficultyOptions: document.getElementById('difficulty-options'),
  diffWarning: document.getElementById('diff-warning'),
  btnDiffAll: document.getElementById('btn-diff-all'),
  btnDiffNone: document.getElementById('btn-diff-none'),

  // ステージ関連
  stageOptions: document.getElementById('stage-options'),
  stageWarning: document.getElementById('stage-warning'),
  btnStageAll: document.getElementById('btn-stage-all'),
  btnStageNone: document.getElementById('btn-stage-none'),

  // キャラクター関連
  characterSelect: document.getElementById('character-select'),
  characterSearchInput: document.getElementById('character-search-input'),
  btnCharClear: document.getElementById('btn-char-clear'),

  // 耐久 & Final ラジオ
  survivalRadios: document.querySelectorAll('input[name="survival-filter"]'),
  finalRadios: document.querySelectorAll('input[name="final-filter"]'),

  // ゲーム制御ボタン
  btnStartGame: document.getElementById('btn-start-game'),
  btnEndGame: document.getElementById('btn-end-game'),
  btnDraw: document.getElementById('btn-draw'),
  btnPass: document.getElementById('btn-pass'),
  btnRemove: document.getElementById('btn-remove'),

  // 挑戦判定ボタン (取得 / 取得失敗)
  btnCaptureSuccess: document.getElementById('btn-capture-success'),
  btnCaptureFailed: document.getElementById('btn-capture-failed'),
  cardResultIndicator: document.getElementById('card-result-indicator'),

  // カード表示エリア
  displayPlaceholder: document.getElementById('display-placeholder'),
  displayEmpty: document.getElementById('display-empty'),
  displayCard: document.getElementById('display-card'),
  cardWork: document.getElementById('card-work'),
  cardCharacter: document.getElementById('card-character'),
  cardNo: document.getElementById('card-no'),
  cardDifficulty: document.getElementById('card-difficulty'),
  cardStage: document.getElementById('card-stage'),
  cardIsSurvival: document.getElementById('card-issurvival'),
  cardIsFinal: document.getElementById('card-isfinal'),
  cardName: document.getElementById('card-name'),
  cardPassStatus: document.getElementById('card-pass-status'),

  // 履歴関連
  historyCount: document.getElementById('history-count'),
  historyList: document.getElementById('history-list'),
  removedCount: document.getElementById('removed-count'),
  removedList: document.getElementById('removed-list')
};

// ==========================================================================
// 6. UI Renderer: ViewRenderer (UI描画・アクセシビリティ・差分更新)
// ==========================================================================
/**
 * DOM更新を担当するレンダラー。
 * 履歴リストの毎回全破棄（innerHTML = ''）を廃止し、差分更新（prepend/ピンポイント更新）を実行。
 */
const ViewRenderer = {
  _notificationTimer: null,

  /**
   * アクティブカードの描画（属性セレクタ [data-diff] スタイリング & ARIA通知）
   * @param {Object} card
   */
  renderActiveCard(card) {
    DOM.displayPlaceholder.classList.add('hidden');
    DOM.displayEmpty.classList.add('hidden');
    DOM.displayCard.classList.remove('hidden');

    DOM.cardWork.textContent = card.workName;
    DOM.cardCharacter.textContent = card.character;
    DOM.cardNo.textContent = `No.${card.spellNo} (通し #${card.id})`;

    DOM.cardDifficulty.textContent = card.difficulty;
    DOM.cardDifficulty.dataset.diff = card.difficulty;
    DOM.displayCard.dataset.diff = card.difficulty;

    DOM.displayCard.setAttribute('aria-label', `抽選結果: ${card.workName}、${card.character}、難易度 ${card.difficulty}、${card.name}`);

    if (card.stage) {
      DOM.cardStage.textContent = SpellFilterEngine.formatStageLabel(card.stage);
      DOM.cardStage.classList.remove('hidden');
    } else {
      DOM.cardStage.classList.add('hidden');
    }

    if (card.isSurvival) {
      DOM.cardIsSurvival.classList.remove('hidden');
    } else {
      DOM.cardIsSurvival.classList.add('hidden');
    }

    if (card.isFinal) {
      DOM.cardIsFinal.textContent = 'Final';
      DOM.cardIsFinal.classList.remove('hidden');
    } else {
      DOM.cardIsFinal.classList.add('hidden');
    }

    DOM.cardName.textContent = card.name;

    DOM.cardResultIndicator.className = 'result-status-indicator status-waiting';
    DOM.cardResultIndicator.innerHTML = '⏳ 挑戦中：取得または失敗を記録してください';

    DOM.cardPassStatus.textContent = '※ このカードに対してパス可能 (1回制限)';
  },

  showPlaceholder() {
    DOM.displayCard.removeAttribute('data-diff');
    DOM.displayPlaceholder.classList.remove('hidden');
    DOM.displayEmpty.classList.add('hidden');
    DOM.displayCard.classList.add('hidden');
  },

  showEmpty() {
    DOM.displayCard.removeAttribute('data-diff');
    DOM.displayPlaceholder.classList.add('hidden');
    DOM.displayEmpty.classList.remove('hidden');
    DOM.displayCard.classList.add('hidden');
  },

  // --------------------------------------------------------------------------
  // 差分更新（Incremental Updates）: 履歴リスト & 除外リスト
  // --------------------------------------------------------------------------

  /**
   * 履歴アイテム要素の作成
   * @param {Object} item
   * @returns {HTMLLIElement}
   */
  createHistoryElement(item) {
    const li = document.createElement('li');
    li.className = 'history-item';

    const left = document.createElement('div');
    left.className = 'history-left';

    const workSpan = document.createElement('span');
    workSpan.className = 'history-work';
    workSpan.textContent = item.workName;
    left.appendChild(workSpan);

    const charSpan = document.createElement('span');
    charSpan.className = 'history-character';
    charSpan.textContent = item.character;
    left.appendChild(charSpan);

    const diffSpan = document.createElement('span');
    diffSpan.className = 'history-diff';
    diffSpan.textContent = item.difficulty;
    diffSpan.dataset.diff = item.difficulty;
    left.appendChild(diffSpan);

    if (item.stage) {
      const stageSpan = document.createElement('span');
      stageSpan.className = 'history-stage';
      stageSpan.textContent = item.stage === 'Ex' ? 'Extra' : item.stage === 'Ph' ? 'Ph' : `St.${item.stage}`;
      left.appendChild(stageSpan);
    }

    if (item.isSurvival) {
      const survSpan = document.createElement('span');
      survSpan.className = 'history-survival';
      survSpan.textContent = '🛡️耐久';
      left.appendChild(survSpan);
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'history-name';
    nameSpan.textContent = item.name;
    left.appendChild(nameSpan);

    const right = document.createElement('div');
    right.className = 'history-right';

    const statusBadge = document.createElement('span');
    statusBadge.className = 'history-status-badge';
    this._applyBadgeStatus(statusBadge, item.status);
    right.appendChild(statusBadge);

    const timeSpan = document.createElement('span');
    timeSpan.className = 'history-time';
    const time = new Date(item.timestamp);
    timeSpan.textContent = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`;
    right.appendChild(timeSpan);

    li.appendChild(left);
    li.appendChild(right);
    return li;
  },

  _applyBadgeStatus(badgeElement, status) {
    badgeElement.className = 'history-status-badge';
    if (status === 'captured') {
      badgeElement.classList.add('badge-captured');
      badgeElement.textContent = '取得成功';
    } else if (status === 'failed') {
      badgeElement.classList.add('badge-failed');
      badgeElement.textContent = '取得失敗';
    } else if (status === 'passed') {
      badgeElement.classList.add('badge-passed');
      badgeElement.textContent = 'パス';
    } else {
      badgeElement.classList.add('badge-pending');
      badgeElement.textContent = '挑戦中';
    }
  },

  /**
   * 履歴表示の初期化（全件クリア）
   */
  resetHistory() {
    DOM.historyList.innerHTML = '<li class="history-empty">まだ履歴がありません</li>';
    DOM.historyCount.textContent = '0';
  },

  /**
   * 新規履歴アイテムを先頭へ差分挿入（prepend）
   * @param {Object} item
   */
  prependHistoryItem(item) {
    const emptyNotice = DOM.historyList.querySelector('.history-empty');
    if (emptyNotice) {
      emptyNotice.remove();
    }
    const li = this.createHistoryElement(item);
    DOM.historyList.prepend(li);
    DOM.historyCount.textContent = appStore.deckManager.history.length;
  },

  /**
   * 直近の履歴アイテムのステータスバッジをピンポイント差分更新
   * @param {'captured'|'failed'|'passed'|'pending'} status
   */
  updateLatestHistoryStatus(status) {
    const firstItem = DOM.historyList.querySelector('.history-item');
    if (!firstItem) return;

    const badge = firstItem.querySelector('.history-status-badge');
    if (badge) {
      this._applyBadgeStatus(badge, status);
    }
  },

  /**
   * 除外リスト表示の初期化
   */
  resetRemovedList() {
    DOM.removedList.innerHTML = '<li class="history-empty">まだ除外されたカードはありません</li>';
    DOM.removedCount.textContent = '0';
  },

  /**
   * 除外カード要素の作成
   * @param {Object} card
   * @returns {HTMLLIElement}
   */
  createRemovedElement(card) {
    const li = document.createElement('li');
    li.className = 'history-item';

    const left = document.createElement('div');
    left.className = 'history-left';

    const workSpan = document.createElement('span');
    workSpan.className = 'history-work';
    workSpan.textContent = card.workName;
    left.appendChild(workSpan);

    const charSpan = document.createElement('span');
    charSpan.className = 'history-character';
    charSpan.textContent = card.character;
    left.appendChild(charSpan);

    const diffSpan = document.createElement('span');
    diffSpan.className = 'history-diff';
    diffSpan.textContent = card.difficulty;
    diffSpan.dataset.diff = card.difficulty;
    left.appendChild(diffSpan);

    if (card.isSurvival) {
      const survSpan = document.createElement('span');
      survSpan.className = 'history-survival';
      survSpan.textContent = '🛡️耐久';
      left.appendChild(survSpan);
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'history-name';
    nameSpan.textContent = card.name;
    left.appendChild(nameSpan);

    const right = document.createElement('div');
    right.className = 'history-right';
    const tag = document.createElement('span');
    tag.className = 'history-status-badge badge-passed';
    tag.textContent = '除外済み';
    right.appendChild(tag);

    li.appendChild(left);
    li.appendChild(right);
    return li;
  },

  /**
   * 除外カードを差分挿入（prepend）
   * @param {Object} card
   */
  prependRemovedItem(card) {
    const emptyNotice = DOM.removedList.querySelector('.history-empty');
    if (emptyNotice) {
      emptyNotice.remove();
    }
    const li = this.createRemovedElement(card);
    DOM.removedList.prepend(li);
    DOM.removedCount.textContent = appStore.deckManager.removedCards.length;
  },

  // --------------------------------------------------------------------------
  // フィルターコントロール描画
  // --------------------------------------------------------------------------

  /**
   * 全フィルターコントロールの一括初期描画
   */
  renderAllFilters() {
    this.renderWorkOptions();
    this.renderDifficultyOptions();
    this.renderCharacterOptions();
    this.renderStageOptions(appStore.getState().availableStages);
  },

  /**
   * 作品選択チェックボックスのレンダリング
   */
  renderWorkOptions() {
    DOM.workOptionsInteger.innerHTML = '';
    DOM.workOptionsFairy.innerHTML = '';
    DOM.workOptionsGaiden.innerHTML = '';

    const { worksList, selectedWorks } = appStore.getState();

    worksList.forEach(work => {
      const label = document.createElement('label');
      label.className = 'check-label';
      label.title = `${work.workName} (${work.workId})`;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = work.workId;
      checkbox.checked = selectedWorks.has(work.workId);

      checkbox.addEventListener('change', () => {
        const current = new Set(appStore.getState().selectedWorks);
        if (checkbox.checked) {
          current.add(work.workId);
        } else {
          current.delete(work.workId);
        }
        appStore.updateWorks(current, true);
      });

      const span = document.createElement('span');
      span.textContent = work.workName;

      label.appendChild(checkbox);
      label.appendChild(span);

      if (work.category === 'INTEGER') {
        DOM.workOptionsInteger.appendChild(label);
      } else if (work.category === 'FAIRY') {
        DOM.workOptionsFairy.appendChild(label);
      } else {
        DOM.workOptionsGaiden.appendChild(label);
      }
    });
  },

  /**
   * 難易度チェックボックスのレンダリング
   */
  renderDifficultyOptions() {
    DOM.difficultyOptions.innerHTML = '';
    const { availableDifficulties, selectedDifficulties } = appStore.getState();

    availableDifficulties.forEach(diff => {
      const label = document.createElement('label');
      label.className = 'check-label';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = diff;
      checkbox.checked = selectedDifficulties.has(diff);

      checkbox.addEventListener('change', () => {
        const current = new Set(appStore.getState().selectedDifficulties);
        if (checkbox.checked) {
          current.add(diff);
        } else {
          current.delete(diff);
        }
        appStore.updateDifficulties(current);
      });

      const span = document.createElement('span');
      span.textContent = diff;

      label.appendChild(checkbox);
      label.appendChild(span);
      DOM.difficultyOptions.appendChild(label);
    });
  },

  /**
   * ステージチェックボックスのレンダリング（差分同期・作品連動）
   * @param {Array<string>} sortedStages
   */
  renderStageOptions(sortedStages) {
    const { selectedWorks, selectedStages } = appStore.getState();
    DOM.stageOptions.innerHTML = '';

    if (sortedStages.length === 0) {
      const p = document.createElement('p');
      p.className = 'placeholder-text';
      p.textContent = selectedWorks.size === 0 ? '作品を選択してください' : '※ 選択作品にステージ区分はありません';
      DOM.stageOptions.appendChild(p);
      return;
    }

    sortedStages.forEach(st => {
      const label = document.createElement('label');
      label.className = 'check-label';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = st;
      checkbox.checked = selectedStages.has(st);

      checkbox.addEventListener('change', () => {
        const current = new Set(appStore.getState().selectedStages);
        if (checkbox.checked) {
          current.add(st);
        } else {
          current.delete(st);
        }
        appStore.updateStages(current);
      });

      const span = document.createElement('span');
      span.textContent = SpellFilterEngine.formatStageLabel(st);

      label.appendChild(checkbox);
      label.appendChild(span);
      DOM.stageOptions.appendChild(label);
    });
  },

  /**
   * キャラクター検索 & 選択の初期化
   */
  renderCharacterOptions() {
    this.updateCharacterDropdownList();

    DOM.characterSelect.addEventListener('change', (e) => {
      appStore.setCharacter(e.target.value);
    });

    DOM.characterSearchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim().toLowerCase();
      this.updateCharacterDropdownList(query);
    });

    DOM.btnCharClear.addEventListener('click', () => {
      DOM.characterSearchInput.value = '';
      appStore.setCharacter('');
      this.updateCharacterDropdownList();
    });
  },

  /**
   * キャラクタードロップダウンの更新（選択中作品の出現キャラ連動）
   * @param {string} query
   */
  updateCharacterDropdownList(query = '') {
    const { allCards, selectedWorks, allCharacters, selectedCharacter } = appStore.getState();
    const activeCharSet = new Set();

    allCards.forEach(card => {
      if (selectedWorks.has(card.workId) && card.character && card.character !== '不明') {
        activeCharSet.add(card.character);
      }
    });

    const baseChars = activeCharSet.size > 0
      ? Array.from(activeCharSet).sort((a, b) => a.localeCompare(b, 'ja'))
      : allCharacters;

    const filteredChars = query
      ? baseChars.filter(c => c.toLowerCase().includes(query))
      : baseChars;

    DOM.characterSelect.innerHTML = '<option value="">すべてのキャラクター (指定なし)</option>';

    filteredChars.forEach(char => {
      const opt = document.createElement('option');
      opt.value = char;
      opt.textContent = char;
      if (char === selectedCharacter) {
        opt.selected = true;
      }
      DOM.characterSelect.appendChild(opt);
    });

    if (selectedCharacter && !filteredChars.includes(selectedCharacter)) {
      appStore.setCharacter('');
      DOM.characterSelect.value = '';
    }
  },

  /**
   * フィルターUIコントロールのチェック状態をストア状態と強制同期
   */
  syncFilterControlsUI() {
    const { selectedWorks, selectedDifficulties, survivalFilter, finalFilter, selectedCharacter } = appStore.getState();

    document.querySelectorAll('#work-options-integer input, #work-options-fairy input, #work-options-gaiden input').forEach(cb => {
      cb.checked = selectedWorks.has(cb.value);
    });

    document.querySelectorAll('#difficulty-options input').forEach(cb => {
      cb.checked = selectedDifficulties.has(cb.value);
    });

    DOM.survivalRadios.forEach(rb => {
      rb.checked = rb.value === survivalFilter;
    });

    DOM.finalRadios.forEach(rb => {
      rb.checked = rb.value === finalFilter;
    });

    DOM.characterSearchInput.value = '';
    DOM.characterSelect.value = selectedCharacter;
  },

  /**
   * 条件合致残り候補数表示の更新
   */
  updateFilteredCountDisplay() {
    const { allCards } = appStore.getState();
    const currentPool = appStore.deckManager.isActive ? appStore.deckManager.deck : allCards;
    const filtered = SpellFilterEngine.filterPool(currentPool, appStore.getCriteria());
    DOM.filteredCount.textContent = filtered.length.toLocaleString();
    return filtered.length;
  },

  /**
   * ボタン活性・非活性状態の一元制御
   */
  updateButtonStates() {
    const state = appStore.getState();
    const deckManager = appStore.deckManager;

    const onlyGaiden = SpellFilterEngine.isOnlyGaidenSelected(state.selectedWorks);
    const hasWorks = state.selectedWorks.size > 0;
    const hasDiffs = state.selectedDifficulties.size > 0 || onlyGaiden;
    const hasStages = state.selectedStages.size > 0 || onlyGaiden || state.availableStages.length === 0;
    const filtersValid = hasWorks && hasDiffs && hasStages;

    // ゲーム開始・終了ボタン
    DOM.btnStartGame.disabled = !filtersValid || state.allCards.length === 0;
    DOM.btnEndGame.disabled = !deckManager.isActive;

    // 現在の山札における合致候補数
    const matchingCount = deckManager.isActive
      ? SpellFilterEngine.filterPool(deckManager.deck, appStore.getCriteria()).length
      : 0;

    // 出力ボタン: ゲーム中 かつ 挑戦中(pending)でない かつ フィルター有効 かつ 残り候補>0
    const isPending = deckManager.isActive && deckManager.challengeState === 'pending';
    DOM.btnDraw.disabled = !deckManager.isActive || isPending || !filtersValid || matchingCount === 0;

    // 挑戦判定ボタン (取得 / 失敗): 挑戦中のみ活性
    DOM.btnCaptureSuccess.disabled = !isPending;
    DOM.btnCaptureFailed.disabled = !isPending;

    // パスボタン: 挑戦中 かつ 未パス かつ 山札に残りの合致候補が存在
    DOM.btnPass.disabled = !isPending || deckManager.passUsedForCurrent || matchingCount === 0;

    // 削除ボタン: 現在カードが存在するとき活性
    DOM.btnRemove.disabled = !deckManager.isActive || !deckManager.currentCard;
  },

  /**
   * ステータスバッジの更新
   */
  updateDataStatus(type, text) {
    DOM.dataStatusBadge.textContent = text;
    DOM.dataStatusBadge.className = 'badge';
    if (type === 'loading') DOM.dataStatusBadge.classList.add('badge-info');
    else if (type === 'success') DOM.dataStatusBadge.classList.add('badge-success');
    else if (type === 'error') DOM.dataStatusBadge.classList.add('badge-danger');
  },

  /**
   * トースト通知の表示
   */
  showNotification(message, type = 'info') {
    if (this._notificationTimer) clearTimeout(this._notificationTimer);

    DOM.notificationBar.textContent = message;
    DOM.notificationBar.className = `notification-bar notification-${type}`;
    DOM.notificationBar.classList.remove('hidden');

    this._notificationTimer = setTimeout(() => {
      DOM.notificationBar.classList.add('hidden');
    }, 4000);
  }
};

// ==========================================================================
// 7. Data Service: DataService (CSV読込・文字コード判別・バリデーション)
// ==========================================================================
/**
 * CSVデータのローダーとスキーマバリデータ。
 * 不正なスキーマや破損行を安全に検証・防御。
 */
const DataService = {
  /**
   * CSVデータのスキーマ検証（タスク 3）
   * @param {Array<Object>} rawRows
   * @returns {{ valid: boolean, error?: string, validRows: Array<Object>, skippedCount: number }}
   */
  validateCSVSchema(rawRows) {
    if (!rawRows || !Array.isArray(rawRows) || rawRows.length === 0) {
      return {
        valid: false,
        error: 'CSVファイル内にデータ行が存在しません。',
        validRows: [],
        skippedCount: 0
      };
    }

    const sampleRow = rawRows[0];
    const rowKeys = Object.keys(sampleRow).map(k => k.trim().toLowerCase());

    // 必須ヘッダー検証: WorkId系
    const hasWorkColumn = REQUIRED_CSV_FIELDS.WORK.some(f => rowKeys.includes(f.toLowerCase()));
    // 必須ヘッダー検証: Name系
    const hasNameColumn = REQUIRED_CSV_FIELDS.NAME.some(f => rowKeys.includes(f.toLowerCase()));

    if (!hasWorkColumn || !hasNameColumn) {
      return {
        valid: false,
        error: 'CSV形式エラー: 必須列「作品 (WorkId)」または「スペル名 (Name)」が見つかりません。CSVファイルのヘッダー行を確認してください。',
        validRows: [],
        skippedCount: 0
      };
    }

    // 各データ行の検証と破損行の安全なスキップ
    const validRows = [];
    let skippedCount = 0;

    rawRows.forEach((row) => {
      const getVal = (...keys) => {
        for (const k of keys) {
          if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
            return String(row[k]).trim();
          }
          const lowerKey = k.toLowerCase();
          for (const rk of Object.keys(row)) {
            if (rk.toLowerCase() === lowerKey && row[rk] !== undefined && row[rk] !== null && String(row[rk]).trim() !== '') {
              return String(row[rk]).trim();
            }
          }
        }
        return '';
      };

      const workId = getVal(...REQUIRED_CSV_FIELDS.WORK);
      const name = getVal(...REQUIRED_CSV_FIELDS.NAME);

      // 作品IDとスペル名の双方が空の場合は破損・無効行として安全にスキップ
      if (!workId && !name) {
        skippedCount++;
        return;
      }

      validRows.push(row);
    });

    if (validRows.length === 0) {
      return {
        valid: false,
        error: 'CSVファイル内に有効なスペルカードデータ行が1行も見つかりませんでした。',
        validRows: [],
        skippedCount
      };
    }

    return {
      valid: true,
      validRows,
      skippedCount
    };
  },

  /**
   * デフォルトCSVのロード（HTTP環境はfetch、file://環境は内蔵データフォールバック）
   */
  loadDefaultCSV() {
    ViewRenderer.updateDataStatus('loading', 'CSV読み込み中...');

    fetch('./SpellList.csv')
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTPエラー: ${response.status} ${response.statusText}`);
        }
        return response.arrayBuffer();
      })
      .then(buffer => {
        const decodedText = this.decodeBuffer(buffer);
        this.parseCSVText(decodedText, 'SpellList.csv');
      })
      .catch(error => {
        console.warn('fetch による自動読込が制限されました (file:// プロトコル等):', error);
        // 内蔵データ (spellData.js) が存在する場合は自動フォールバック
        if (typeof window.DEFAULT_SPELL_CSV === 'string' && window.DEFAULT_SPELL_CSV.length > 0) {
          console.info('内蔵データ (spellData.js) から自動展開します。');
          this.parseCSVText(window.DEFAULT_SPELL_CSV, 'SpellList.csv (内蔵データ)');
        } else {
          ViewRenderer.updateDataStatus('error', 'CSV自動読込失敗 (手動読込してください)');
          ViewRenderer.showNotification('デフォルトCSVの読込に失敗しました。右上の「📁 別のCSVを読込」から「SpellList.csv」を選択してください。', 'warning');
        }
      });
  },

  /**
   * ArrayBuffer をデコード（UTF-8 試行後、失敗時に Shift-JIS / CP932 フォールバック）
   */
  decodeBuffer(buffer) {
    try {
      const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
      return utf8Decoder.decode(buffer);
    } catch (e) {
      const sjisDecoder = new TextDecoder('shift-jis');
      return sjisDecoder.decode(buffer);
    }
  },

  /**
   * PapaParse を用いたCSV文字列のパース
   */
  parseCSVText(csvText, fileName) {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        this.processLoadedData(results.data, fileName);
      },
      error: (err) => {
        console.error('CSVパースエラー:', err);
        ViewRenderer.updateDataStatus('error', 'パースエラー');
        ViewRenderer.showNotification('CSVの解析中にエラーが発生しました: ' + err.message, 'danger');
      }
    });
  },

  /**
   * パース済みRAWデータをバリデーション・正規化し、ストアを初期化
   */
  processLoadedData(rawRows, fileName) {
    // スキーマバリデーション実行
    const validation = this.validateCSVSchema(rawRows);
    if (!validation.valid) {
      ViewRenderer.updateDataStatus('error', 'バリデーションエラー');
      ViewRenderer.showNotification(validation.error, 'danger');
      return;
    }

    if (validation.skippedCount > 0) {
      console.warn(`破損行・空行を ${validation.skippedCount} 件安全にスキップしました。`);
    }

    const cards = [];
    const worksMap = new Map();
    const characterSet = new Set();
    const difficultySet = new Set();
    let hasSurvival = false;
    let hasFinal = false;

    validation.validRows.forEach((row, index) => {
      const getVal = (...keys) => {
        for (const k of keys) {
          if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
            return String(row[k]).trim();
          }
          const lowerKey = k.toLowerCase();
          for (const rk of Object.keys(row)) {
            if (rk.toLowerCase() === lowerKey && row[rk] !== undefined && row[rk] !== null && String(row[rk]).trim() !== '') {
              return String(row[rk]).trim();
            }
          }
        }
        return '';
      };

      const id = parseInt(getVal('Id', 'id'), 10) || (index + 1);
      const workId = getVal(...REQUIRED_CSV_FIELDS.WORK) || 'th00';
      const workName = getVal('WorkName', 'work_name') || workId;
      const spellNo = getVal('SpellNo', 'spell_no', 'No', 'no') || String(index + 1);
      let stage = getVal('Stage', 'stage');
      const character = getVal('Character', 'character', 'Enemy', 'Boss') || '不明';
      let difficulty = getVal('Difficulty', 'difficulty', 'Diff', 'diff');
      const name = getVal(...REQUIRED_CSV_FIELDS.NAME) || '（無名のスペル）';

      // 難易度の正規化 (Ex -> Extra, 空白 -> なし)
      if (difficulty === 'Ex') difficulty = 'Extra';
      if (!difficulty) {
        difficulty = 'なし (撮影・外伝系)';
      }

      // 耐久スペル判定
      const rawSurvival = getVal('isSurvival', 'issurvival', 'Survival', 'survival').toLowerCase();
      const isSurvival = rawSurvival === 'true' || rawSurvival === '1';
      if (rawSurvival !== '') hasSurvival = true;

      // isIntegerWork判定
      const rawInteger = getVal('isIntegerWork', 'isintegerwork', 'isInteger').toLowerCase();
      let isIntegerWork = rawInteger === 'true' || rawInteger === '1';
      if (rawInteger === '') {
        isIntegerWork = WORK_CATEGORIES.INTEGER.includes(workId);
      }

      // Finalスペル判定
      const rawFinal = getVal('isFinal', 'isfinal', 'Final', 'final').toLowerCase();
      const isFinal = rawFinal === 'true' || rawFinal === '1';
      if (rawFinal !== '') hasFinal = true;

      // 作品マスタ収集
      if (!worksMap.has(workId)) {
        let category = 'INTEGER';
        if (WORK_CATEGORIES.FAIRY.includes(workId)) category = 'FAIRY';
        else if (WORK_CATEGORIES.GAIDEN.includes(workId)) category = 'GAIDEN';
        else if (!isIntegerWork) category = 'GAIDEN';

        worksMap.set(workId, {
          workId,
          workName,
          isIntegerWork,
          category
        });
      }

      if (character && character !== '不明') {
        characterSet.add(character);
      }
      difficultySet.add(difficulty);

      cards.push({
        id,
        workId,
        workName,
        spellNo,
        stage,
        character,
        difficulty,
        name,
        isSurvival,
        isIntegerWork,
        isFinal
      });
    });

    const worksList = Array.from(worksMap.values());
    const allCharacters = Array.from(characterSet).sort((a, b) => a.localeCompare(b, 'ja'));

    // 難易度ソート
    const availableDifficulties = Array.from(difficultySet).sort((a, b) => {
      const idxA = DIFFICULTY_ORDER.indexOf(a);
      const idxB = DIFFICULTY_ORDER.indexOf(b);
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });

    const selectedWorks = new Set(worksList.map(w => w.workId));
    const selectedDifficulties = new Set(availableDifficulties);
    const availableStages = SpellFilterEngine.extractAvailableStages(cards, selectedWorks);
    const selectedStages = new Set(availableStages);

    // AppStore の更新（単方向データフロー）
    appStore.setMasterData({
      allCards: cards,
      worksList,
      availableDifficulties,
      availableStages,
      allCharacters,
      hasSurvivalColumn: hasSurvival,
      hasFinalColumn: hasFinal,
      selectedWorks,
      selectedDifficulties,
      selectedStages
    });

    // カウントとステータス表示の更新
    DOM.totalCount.textContent = cards.length.toLocaleString();
    ViewRenderer.updateDataStatus('success', `${fileName} (${cards.length.toLocaleString()}枚)`);
    ViewRenderer.showNotification(`データ読み込み完了: 全${cards.length.toLocaleString()}枚のスペルカードを登録しました。`, 'success');

    // ゲーム状態終了 & リセット
    GameController.end(false);
    ViewRenderer.renderAllFilters();
    ViewRenderer.updateFilteredCountDisplay();
    ViewRenderer.updateButtonStates();
  }
};

// ==========================================================================
// 8. Game Controller: GameController (進行オーケストレーション)
// ==========================================================================
/**
 * ユーザー操作とビジネスロジック・描画を仲介するコントローラー
 */
const GameController = {
  start() {
    const { allCards } = appStore.getState();
    const result = appStore.deckManager.start(allCards);
    if (!result.success) {
      ViewRenderer.showNotification('カードデータが存在しません。CSVを読み込んでください。', 'warning');
      return;
    }

    DOM.gameStatusText.textContent = '進行中 (PLAYING)';
    DOM.gameStatusText.className = 'status-value status-playing';
    DOM.deckCount.textContent = result.deckCount.toLocaleString();

    ViewRenderer.resetHistory();
    ViewRenderer.resetRemovedList();
    ViewRenderer.showPlaceholder();
    ViewRenderer.updateFilteredCountDisplay();
    ViewRenderer.updateButtonStates();

    ViewRenderer.showNotification('ゲームを開始しました！「スペル出力」を押して挑戦を始めましょう。', 'success');
  },

  end(showNotice = true) {
    appStore.deckManager.end();

    DOM.gameStatusText.textContent = '待機中 (STANDBY)';
    DOM.gameStatusText.className = 'status-value status-standby';
    DOM.deckCount.textContent = '0';

    ViewRenderer.showPlaceholder();
    ViewRenderer.updateFilteredCountDisplay();
    ViewRenderer.updateButtonStates();

    if (showNotice) {
      ViewRenderer.showNotification('ゲームを終了しました。', 'info');
    }
  },

  draw() {
    const deckManager = appStore.deckManager;
    if (!deckManager.isActive) {
      ViewRenderer.showNotification('ゲームを開始してください。', 'warning');
      return;
    }

    if (deckManager.challengeState === 'pending') {
      ViewRenderer.showNotification('現在のスペルカードの取得成否を記録してください。', 'warning');
      return;
    }

    const result = deckManager.draw(appStore.getCriteria());
    if (!result.success) {
      if (result.reason === 'empty_pool') {
        ViewRenderer.showEmpty();
        ViewRenderer.updateButtonStates();
      }
      return;
    }

    DOM.deckCount.textContent = result.deckCount.toLocaleString();

    // アクティブカード描画
    ViewRenderer.renderActiveCard(result.card);
    // 履歴へ差分追加 (prepend)
    ViewRenderer.prependHistoryItem(result.historyItem);

    ViewRenderer.updateFilteredCountDisplay();
    ViewRenderer.updateButtonStates();
  },

  recordResult(isSuccess) {
    const result = appStore.deckManager.recordResult(isSuccess);
    if (!result.success) return;

    if (isSuccess) {
      DOM.cardResultIndicator.className = 'result-status-indicator status-captured';
      DOM.cardResultIndicator.innerHTML = '✨ 取得成功！お見事！';
      ViewRenderer.showNotification(`【取得成功】${result.card.name} を取得しました！`, 'success');
    } else {
      DOM.cardResultIndicator.className = 'result-status-indicator status-failed';
      DOM.cardResultIndicator.innerHTML = '💥 取得失敗 (被弾/ミス)';
      ViewRenderer.showNotification(`【取得失敗】${result.card.name} は被弾しました。`, 'danger');
    }

    DOM.cardPassStatus.textContent = '※ 判定記録済み。次のスペルカードを出力できます。';

    // 履歴先頭要素のバッジをピンポイント差分更新
    ViewRenderer.updateLatestHistoryStatus(result.result);
    ViewRenderer.updateButtonStates();
  },

  pass() {
    const result = appStore.deckManager.pass(appStore.getCriteria());
    if (!result.success) {
      if (result.reason === 'empty_pool') {
        ViewRenderer.showNotification('山札に残りの合致候補がないため、別のカードへパスできません。', 'warning');
      }
      return;
    }

    // 直前履歴アイテムのバッジを passed にピンポイント差分更新
    ViewRenderer.updateLatestHistoryStatus('passed');
    // 新カードの履歴アイテムを先頭に差分挿入 (prepend)
    ViewRenderer.prependHistoryItem(result.newHistoryItem);

    DOM.deckCount.textContent = result.deckCount.toLocaleString();
    ViewRenderer.renderActiveCard(result.card);
    DOM.cardPassStatus.textContent = '※ パスを使用しました（このカードでは再パス不可）';

    ViewRenderer.updateFilteredCountDisplay();
    ViewRenderer.showNotification('パスを使用しました。新しいスペルカードを出力しました。', 'info');
    ViewRenderer.updateButtonStates();
  },

  removeCurrent() {
    const result = appStore.deckManager.removeCurrent();
    if (!result.success) return;

    // もし直前のカードが挑戦中だった場合はバッジを差分更新
    if (result.updatedHistoryItem) {
      ViewRenderer.updateLatestHistoryStatus('passed');
    }

    // 除外リストに差分挿入 (prepend)
    ViewRenderer.prependRemovedItem(result.removedCard);

    DOM.deckCount.textContent = result.deckCount.toLocaleString();
    ViewRenderer.updateFilteredCountDisplay();
    ViewRenderer.showPlaceholder();
    ViewRenderer.showNotification(`「${result.removedCard.name}」を山札から除外しました。`, 'info');
    ViewRenderer.updateButtonStates();
  }
};

// ==========================================================================
// 9. Event Handlers & Application Bootstrap (イベント登録・高階関数・起動)
// ==========================================================================

/**
 * チェックボックスの一括選択/全解除ボタンに共通のハンドラーをバインドする高階関数（タスク 5）
 * @param {Object} options
 * @param {HTMLElement} options.btnAll
 * @param {HTMLElement} options.btnNone
 * @param {Function} options.getTargetValues
 * @param {string} options.containerSelector
 * @param {Function} options.onUpdate
 */
function bindBulkToggle({ btnAll, btnNone, getTargetValues, containerSelector, onUpdate }) {
  if (btnAll) {
    btnAll.addEventListener('click', () => {
      const values = getTargetValues();
      const checkboxes = document.querySelectorAll(`${containerSelector} input[type="checkbox"]`);
      checkboxes.forEach(cb => {
        if (values.includes(cb.value)) {
          cb.checked = true;
        }
      });
      onUpdate(values, true);
    });
  }

  if (btnNone) {
    btnNone.addEventListener('click', () => {
      const values = getTargetValues();
      const checkboxes = document.querySelectorAll(`${containerSelector} input[type="checkbox"]`);
      checkboxes.forEach(cb => {
        if (values.includes(cb.value)) {
          cb.checked = false;
        }
      });
      onUpdate(values, false);
    });
  }
}

/**
 * プリセット表示名の取得
 */
function getPresetDisplayName(type) {
  switch (type) {
    case 'main-normal': return '本編 (Normal)';
    case 'extra-phantasm': return 'Extra / Phantasm';
    case 'survival': return '全耐久スペル';
    case 'th08': return '永夜抄のみ';
    case 'th128': return '妖精大戦争';
    case 'reset': return '全条件リセット';
    default: return type;
  }
}

/**
 * イベントリスナーのセットアップ
 */
function setupEventListeners() {
  // 1. CSV手動インポート
  DOM.csvFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    ViewRenderer.updateDataStatus('loading', `${file.name} 読込中...`);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const buffer = evt.target.result;
      const decodedText = DataService.decodeBuffer(buffer);
      DataService.parseCSVText(decodedText, file.name);
    };
    reader.onerror = () => {
      ViewRenderer.updateDataStatus('error', '読込失敗');
      ViewRenderer.showNotification('ファイルの読み込みに失敗しました。', 'danger');
    };
    reader.readAsArrayBuffer(file);
  });

  // 2. クイックプリセットボタン
  DOM.presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const presetType = btn.getAttribute('data-preset');
      appStore.applyPreset(presetType);
      ViewRenderer.syncFilterControlsUI();
      ViewRenderer.renderStageOptions(appStore.getState().availableStages);
      ViewRenderer.updateCharacterDropdownList();
      ViewRenderer.showNotification(`プリセット「${getPresetDisplayName(presetType)}」を適用しました。`, 'info');
    });
  });

  // 3. 作品一括選択/解除（高階関数によるDRY化）
  bindBulkToggle({
    btnAll: DOM.btnWorkAll,
    btnNone: DOM.btnWorkNone,
    getTargetValues: () => appStore.getState().worksList.map(w => w.workId),
    containerSelector: '#work-options-integer, #work-options-fairy, #work-options-gaiden',
    onUpdate: (values, isSelectAll) => {
      const current = isSelectAll ? new Set(values) : new Set();
      appStore.updateWorks(current, false);
    }
  });

  bindBulkToggle({
    btnAll: DOM.btnWorkIntegerAll,
    btnNone: DOM.btnWorkIntegerNone,
    getTargetValues: () => WORK_CATEGORIES.INTEGER,
    containerSelector: '#work-options-integer',
    onUpdate: (values, isSelectAll) => {
      const current = new Set(appStore.getState().selectedWorks);
      values.forEach(id => isSelectAll ? current.add(id) : current.delete(id));
      appStore.updateWorks(current, true);
    }
  });

  bindBulkToggle({
    btnAll: DOM.btnWorkGaidenAll,
    btnNone: DOM.btnWorkGaidenNone,
    getTargetValues: () => WORK_CATEGORIES.GAIDEN,
    containerSelector: '#work-options-gaiden',
    onUpdate: (values, isSelectAll) => {
      const current = new Set(appStore.getState().selectedWorks);
      values.forEach(id => isSelectAll ? current.add(id) : current.delete(id));
      appStore.updateWorks(current, true);
    }
  });

  // 妖精大戦争トグル
  DOM.btnWorkFairyToggle.addEventListener('click', () => {
    const fairyId = 'th12.8';
    const current = new Set(appStore.getState().selectedWorks);
    if (current.has(fairyId)) {
      current.delete(fairyId);
    } else {
      current.add(fairyId);
    }
    document.querySelectorAll('#work-options-fairy input').forEach(cb => {
      cb.checked = current.has(fairyId);
    });
    appStore.updateWorks(current, true);
  });

  // 4. 難易度一括選択/解除（高階関数によるDRY化）
  bindBulkToggle({
    btnAll: DOM.btnDiffAll,
    btnNone: DOM.btnDiffNone,
    getTargetValues: () => appStore.getState().availableDifficulties,
    containerSelector: '#difficulty-options',
    onUpdate: (values, isSelectAll) => {
      appStore.updateDifficulties(isSelectAll ? values : []);
    }
  });

  // 5. ステージ一括選択/解除（高階関数によるDRY化）
  bindBulkToggle({
    btnAll: DOM.btnStageAll,
    btnNone: DOM.btnStageNone,
    getTargetValues: () => appStore.getState().availableStages,
    containerSelector: '#stage-options',
    onUpdate: (values, isSelectAll) => {
      appStore.updateStages(isSelectAll ? values : []);
    }
  });

  // 6. 耐久 & Final ラジオボタン
  DOM.survivalRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      appStore.setSurvivalFilter(e.target.value);
    });
  });

  DOM.finalRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      appStore.setFinalFilter(e.target.value);
    });
  });

  // 7. ゲーム進行アクションボタン
  DOM.btnStartGame.addEventListener('click', () => GameController.start());
  DOM.btnEndGame.addEventListener('click', () => GameController.end(true));
  DOM.btnDraw.addEventListener('click', () => GameController.draw());

  // 8. 挑戦判定ボタン (取得 / 失敗)
  DOM.btnCaptureSuccess.addEventListener('click', () => GameController.recordResult(true));
  DOM.btnCaptureFailed.addEventListener('click', () => GameController.recordResult(false));

  // 9. パス & 削除ボタン
  DOM.btnPass.addEventListener('click', () => GameController.pass());
  DOM.btnRemove.addEventListener('click', () => GameController.removeCurrent());

  // 10. Store 変更通知に対するリアクティブUI同期
  appStore.subscribe((newState, prevState, changedKeys) => {
    const onlyGaiden = SpellFilterEngine.isOnlyGaidenSelected(newState.selectedWorks);

    // 作品選択のバリデーション警告
    if (changedKeys.includes('selectedWorks')) {
      DOM.workWarning.classList.toggle('hidden', newState.selectedWorks.size > 0);
      ViewRenderer.renderStageOptions(newState.availableStages);
      ViewRenderer.updateCharacterDropdownList(DOM.characterSearchInput.value.trim().toLowerCase());
    }

    // 難易度選択のバリデーション警告
    if (changedKeys.includes('selectedDifficulties') || changedKeys.includes('selectedWorks')) {
      const showDiffWarning = newState.selectedDifficulties.size === 0 && !onlyGaiden;
      DOM.diffWarning.classList.toggle('hidden', !showDiffWarning);
    }

    // ステージ選択のバリデーション警告
    if (changedKeys.includes('selectedStages') || changedKeys.includes('selectedWorks')) {
      const showStageWarning = newState.availableStages.length > 0 && newState.selectedStages.size === 0 && !onlyGaiden;
      DOM.stageWarning.classList.toggle('hidden', !showStageWarning);
    }

    // 残り件数表示とボタン状態の連動更新
    ViewRenderer.updateFilteredCountDisplay();
    ViewRenderer.updateButtonStates();
  });
}

// ==========================================================================
// アプリケーション初期化ブートストラップ
// ==========================================================================
window.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  DataService.loadDefaultCSV();
});