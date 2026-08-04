// 房產投資合夥財務管理系統 (IFMS) - 前端核心邏輯

// --- 設定檔讀取 (預設從 config.js 載入) ---
// 若 config.js 未建立，此處提供安全備用結構
if (typeof CONFIG === "undefined") {
  window.CONFIG = {
    GOOGLE_CLIENT_ID: "YOUR_GOOGLE_CLIENT_ID",
    GAS_API_URL: "YOUR_GAS_API_URL"
  };
}

// --- 全局狀態 ---
let appState = {
  idToken: null,
  userProfile: null,
  dashboard: null,
  transactions: [],
  contracts: [],
  loanSummary: null,
  cashflowForecast: [],
  activeContractSchedule: null,
  selectedFileBase64: null,
  selectedFileName: null,
  activeTab: "dashboard"
};

// 建議預設分類對照表
const CATEGORY_MAP = {
  "支出": {
    "前期": ["訂金", "簽約金", "開工款", "工程期款", "交屋尾款", "裝潢款", "代書/仲介費", "契稅/印花稅", "其他支出"],
    "中期": ["水費", "電費", "管理費", "房屋稅/地價稅", "房貸本金", "房貸利息", "保險費", "修繕費", "出租仲介佣金", "其他支出"],
    "後期": ["售屋仲介費", "資本利得稅", "貸款清償", "其他支出"]
  },
  "收入": {
    "前期": ["其他收入"],
    "中期": ["出租租金收入", "退稅/補助", "其他收入"],
    "後期": ["售屋收入", "其他收入"]
  },
  "沖帳": {
    "前期": ["合夥人拆帳", "償還代墊款"],
    "中期": ["合夥人拆帳", "償還代墊款"],
    "後期": ["合夥人拆帳", "償還代墊款"]
  },
  "存入共同帳戶": {
    "前期": ["預存資金", "特別增資"],
    "中期": ["預存資金", "特別增資"],
    "後期": ["預存資金", "特別增資"]
  },
  "從共同帳戶借支": {
    "前期": ["個人借支", "臨時資金調度"],
    "中期": ["個人借支", "臨時資金調度"],
    "後期": ["個人借支", "臨時資金調度"]
  }
};

// --- 頁面載入初始化 ---
document.addEventListener("DOMContentLoaded", () => {
  initGoogleLibrary();
  setupEventListeners();
  checkExistingSession();
});

// 檢查是否有既存的登入 Session
function checkExistingSession() {
  const savedToken = localStorage.getItem("ifms_id_token");
  if (savedToken) {
    appState.idToken = savedToken;
    showLoading(true);
    fetchData();
  } else {
    showLoading(false);
  }
}

// 載入 Google GIS 函式庫
function initGoogleLibrary() {
  // 動態更新 HTML 元素中的 Client ID
  const onloadEl = document.getElementById("g_id_onload");
  if (onloadEl && typeof CONFIG !== "undefined" && CONFIG.GOOGLE_CLIENT_ID && !CONFIG.GOOGLE_CLIENT_ID.startsWith("YOUR_")) {
    onloadEl.setAttribute("data-client_id", CONFIG.GOOGLE_CLIENT_ID);
  }
}

// Google 登入回呼函式 (全域作用域)
window.handleCredentialResponse = function (response) {
  const jwt = response.credential;
  appState.idToken = jwt;
  localStorage.setItem("ifms_id_token", jwt);

  showLoading(true);
  fetchData();
};

// --- API 溝通 ---
async function callAPI(action, data = null, options = {}) {
  const { suppressAlert = false } = options;

  if (!appState.idToken) {
    if (!suppressAlert) alert("您尚未登入或 Session 已過期。");
    logout();
    return null;
  }

  if (CONFIG.GAS_API_URL === "YOUR_GAS_API_URL" || !CONFIG.GAS_API_URL) {
    if (!suppressAlert) alert("請先在 config.js 中設定正確的 GAS_API_URL。");
    showLoading(false);
    return null;
  }

  try {
    const payload = {
      action: action,
      idToken: appState.idToken,
      data: data
    };

    const response = await fetch(CONFIG.GAS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload),
      redirect: "follow"
    });

    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseErr) {
      if (responseText.includes("<!DOCTYPE") || responseText.includes("<html")) {
        throw new Error("後端傳回 HTML 網頁。請確認 Google Apps Script 部署權限設定：\n1. Web App 的「誰有存取權限」是否設為「所有人 (Anyone)」\n2. 執行身分是否設為「我 (Me)」");
      }
      throw new Error(`無效的 JSON 回應: ${responseText.slice(0, 100)}`);
    }

    // 檢查是否誤中 doGet (HTTP 302 將 POST 轉為 GET 時)
    if (result.status === "ok" && result.message) {
      throw new Error(`API 請求被轉換為 GET 請求 (${result.message})。請重新發布/更新 Apps Script 部署。`);
    }

    if (result.success) {
      return result.data;
    } else {
      throw new Error(result.message || "未知的後端錯誤");
    }
  } catch (error) {
    console.error(`API Error (${action}):`, error);
    if (!suppressAlert) {
      alert(`API 錯誤 (${action}):\n${error.message}`);
    }
    return null;
  }
}

// 取得最新資料並渲染畫面
async function fetchData() {
  const [dashboardData, txData, contractsData, loanSummaryData, cashflowData] = await Promise.all([
    callAPI("getDashboard", null, { suppressAlert: true }),
    callAPI("getTransactions", null, { suppressAlert: true }),
    callAPI("getContracts", null, { suppressAlert: true }),
    callAPI("getLoanSummary", null, { suppressAlert: true }),
    callAPI("getCashFlowForecast", null, { suppressAlert: true })
  ]);

  if (!dashboardData && !txData) {
    alert("無法取得核心資料。\n\n常見原因與解決步驟：\n1. Google Apps Script 尚未部署最新程式碼（請至 Apps Script 點擊「部署」->「管理部署」->「選擇最新版本 (New version)」）。\n2. Web App 存取權限未設為「所有人 (Anyone)」。\n3. Google 帳號 Token 已過期，請嘗試重新登入。");
    showLoading(false);
    return;
  }

  appState.dashboard = dashboardData || {};
  appState.transactions = txData || [];
  appState.contracts = contractsData || [];
  appState.loanSummary = loanSummaryData || { hasLoan: false };
  appState.cashflowForecast = cashflowData || [];

  // 解析 Token 中的使用者資訊以顯示名稱
  try {
    const payload = JSON.parse(atob(appState.idToken.split('.')[1]));
    appState.userProfile = payload;
    document.getElementById("user-display-name").innerText = payload.name || payload.email;
    document.getElementById("settings-user-email").innerText = payload.email || "-";
  } catch (e) {
    document.getElementById("user-display-name").innerText = "合夥人";
  }

  renderDashboard();
  renderLoanSummary();
  renderCashFlowForecast();
  renderTransactions(appState.transactions);
  renderContracts();

  document.getElementById("login-container").classList.add("hidden");
  document.getElementById("app-container").classList.remove("hidden");
  showLoading(false);
}

// --- 畫面渲染 ---

function renderDashboard() {
  const db = appState.dashboard;
  if (!db) return;

  // 格式化貨幣
  const formatCurrency = (val) => "$" + Math.round(val).toLocaleString();

  // 數據指標
  document.getElementById("metric-total-expense").innerText = formatCurrency(db.summary.totalExpense);
  document.getElementById("metric-total-income").innerText = formatCurrency(db.summary.totalIncome);
  document.getElementById("metric-net-cost").innerText = formatCurrency(db.summary.netCost);
  const ratioEl = document.getElementById("metric-ratio");
  if (ratioEl) {
    ratioEl.innerText = `A: ${db.currentRatio.ratioA * 100}% | B: ${db.currentRatio.ratioB * 100}%`;
  }
  document.getElementById("metric-joint-cash").innerText = formatCurrency(db.summary.jointCash);

  // 雙方財務詳情
  document.getElementById("partner-a-paid").innerText = formatCurrency(db.partners.A.paid);
  document.getElementById("partner-a-should-pay").innerText = formatCurrency(db.partners.A.shouldPay);
  document.getElementById("partner-a-received").innerText = formatCurrency(db.partners.A.received);
  document.getElementById("partner-a-should-get").innerText = formatCurrency(db.partners.A.shouldGet);
  document.getElementById("partner-a-recon").innerText = formatCurrency(db.partners.A.reconPaid);
  document.getElementById("partner-a-deposit").innerText = formatCurrency(db.partners.A.deposit || 0);
  document.getElementById("partner-a-borrow").innerText = formatCurrency(db.partners.A.borrow || 0);

  document.getElementById("partner-b-paid").innerText = formatCurrency(db.partners.B.paid);
  document.getElementById("partner-b-should-pay").innerText = formatCurrency(db.partners.B.shouldPay);
  document.getElementById("partner-b-received").innerText = formatCurrency(db.partners.B.received);
  document.getElementById("partner-b-should-get").innerText = formatCurrency(db.partners.B.shouldGet);
  document.getElementById("partner-b-recon").innerText = formatCurrency(db.partners.B.reconPaid);
  document.getElementById("partner-b-deposit").innerText = formatCurrency(db.partners.B.deposit || 0);
  document.getElementById("partner-b-borrow").innerText = formatCurrency(db.partners.B.borrow || 0);

  // 代墊狀態與樣式調整
  const renderAdvanceBalance = (elementId, value) => {
    const el = document.getElementById(elementId);
    el.className = "advance-status";
    if (value > 0) {
      el.classList.add("positive");
      el.innerText = `多代墊 ${formatCurrency(value)}`;
    } else if (value < 0) {
      el.classList.add("negative");
      el.innerText = `少繳/需補足 ${formatCurrency(Math.abs(value))}`;
    } else {
      el.classList.add("zero");
      el.innerText = "已結清 0";
    }
  };

  renderAdvanceBalance("partner-a-advance", db.partners.A.netAdvance);
  renderAdvanceBalance("partner-b-advance", db.partners.B.netAdvance);

  // 頂部結算橫幅說明
  const bannerText = document.getElementById("settlement-status-text");
  const progressBar = document.getElementById("settlement-progress-bar");

  if (db.settlement.whosAdvancing === "A") {
    bannerText.innerHTML = `Elaine 需償還 <span style="color:var(--sage-green);font-weight:700;">${formatCurrency(db.settlement.amount)}</span> 給 A (Joanna)`;
    // 進度條偏向 A (例如 A 代墊多，進度條到 75%)
    progressBar.style.width = "75%";
  } else if (db.settlement.whosAdvancing === "B") {
    bannerText.innerHTML = `Joanna 需償還 <span style="color:var(--accent-gold);font-weight:700;">${formatCurrency(db.settlement.amount)}</span> 給 Elaine`;
    // 進度條偏向 B (例如 B 代墊多，進度條到 25%)
    progressBar.style.width = "25%";
  } else {
    bannerText.innerText = "雙方代墊款項已完全結清！";
    progressBar.style.width = "50%";
  }
}

function renderTransactions(txs) {
  const tbody = document.getElementById("transactions-list-body");
  tbody.innerHTML = "";

  if (txs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="color:var(--text-muted);">查無符合的交易紀錄</td></tr>`;
    return;
  }

  txs.forEach(tx => {
    const tr = document.createElement("tr");

    // 類型標籤樣式
    let typeClass = "";
    if (tx.type === "支出") typeClass = "expense";
    else if (tx.type === "收入") typeClass = "income";
    else if (tx.type === "存入共同帳戶") typeClass = "deposit";
    else if (tx.type === "從共同帳戶借支") typeClass = "borrow";
    else typeClass = "recon";

    // 期別標籤
    const stageTag = `<span class="stage-tag">${tx.stage}</span>`;

    // 附件按鈕
    let attachmentCell = "";
    if (tx.attachments && tx.attachments.length > 0) {
      tx.attachments.forEach(url => {
        attachmentCell += `<span class="att-link" title="查看收據照片"><i class="fa-solid fa-receipt"></i></span>`;
      });
    } else {
      attachmentCell = `<span style="color:var(--text-muted);font-size:0.8rem;">無附件</span>`;
    }

    // 備註長度限制
    const desc = tx.description || "";

    tr.innerHTML = `
      <td>${tx.date}</td>
      <td><span class="tx-badge ${typeClass}">${tx.type}</span></td>
      <td>${stageTag}</td>
      <td>${tx.category}</td>
      <td>${tx.payer === "A" ? "Joanna" : (tx.payer === "B" ? "Elaine" : "共同帳戶")}</td>
      <td class="td-amount ${typeClass}">${tx.type === "支出" || tx.type === "從共同帳戶借支" ? "-" : (tx.type === "收入" || tx.type === "存入共同帳戶" ? "+" : "")}${Math.round(tx.amount).toLocaleString()}</td>
      <td style="max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${desc}">${desc}</td>
      <td class="attachment-preview-area">${attachmentCell}</td>
      <td><button class="btn-edit" data-id="${tx.id}"><i class="fa-solid fa-pen-to-square"></i> 編輯</button></td>
    `;

    // 為收據連結綁定點擊事件放大圖片
    if (tx.attachments && tx.attachments.length > 0) {
      const link = tr.querySelector(".att-link");
      if (link) {
        link.addEventListener("click", () => {
          openImageViewer(tx.attachments[0]);
        });
      }
    }

    // 綁定編輯按鈕事件
    const editBtn = tr.querySelector(".btn-edit");
    editBtn.addEventListener("click", () => {
      openEditModal(tx);
    });

    tbody.appendChild(tr);
  });
}

// --- 事件處理與互動 ---

function setupEventListeners() {
  // 登出按鈕
  document.getElementById("logout-btn").addEventListener("click", logout);

  // 篩選與搜尋
  document.getElementById("filter-stage").addEventListener("change", applyFilters);
  document.getElementById("filter-type").addEventListener("change", applyFilters);
  document.getElementById("search-desc").addEventListener("input", applyFilters);

  // 開關記帳視窗
  const addModal = document.getElementById("add-modal");
  document.getElementById("open-add-modal-btn").addEventListener("click", () => {
    // 設定預設日期為今天
    document.getElementById("tx-date").value = new Date().toISOString().split("T")[0];
    updateCategoryOptions();
    addModal.classList.add("open");
  });

  const closeModal = () => {
    addModal.classList.remove("open");
    resetAddForm();
  };
  document.getElementById("close-modal-btn").addEventListener("click", closeModal);
  document.getElementById("cancel-modal-btn").addEventListener("click", closeModal);

  // 交易類型或期別變更時更新類別下拉選項
  const typeSelect = document.getElementById("tx-type");
  const stageSelect = document.getElementById("tx-stage");

  typeSelect.addEventListener("change", () => {
    updateCategoryOptions();
    // 沖帳類型時，將「付款人」標籤改為「付款方」
    const payerLabel = document.getElementById("payer-label");
    const payerSelect = document.getElementById("tx-payer");
    const jointOption = payerSelect.querySelector('option[value="共同帳戶"]');

    if (typeSelect.value === "沖帳" || typeSelect.value === "存入共同帳戶" || typeSelect.value === "從共同帳戶借支") {
      if (jointOption) jointOption.style.display = "none";
      if (payerSelect.value === "共同帳戶") payerSelect.value = "A"; // 預設為 Joanna
    } else {
      if (jointOption) jointOption.style.display = "";
    }

    if (typeSelect.value === "沖帳") {
      payerLabel.innerHTML = `付款方 <span class="required">*</span>`;
    } else if (typeSelect.value === "存入共同帳戶") {
      payerLabel.innerHTML = `存入人 <span class="required">*</span>`;
    } else if (typeSelect.value === "從共同帳戶借支") {
      payerLabel.innerHTML = `借支人 <span class="required">*</span>`;
    } else {
      payerLabel.innerHTML = `經手人/付(收)款人 <span class="required">*</span>`;
    }
  });
  stageSelect.addEventListener("change", updateCategoryOptions);

  // 拖曳上傳收據
  const dragDropArea = document.getElementById("drag-drop-area");
  const fileInput = document.getElementById("tx-file");

  dragDropArea.addEventListener("click", () => fileInput.click());

  dragDropArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    dragDropArea.classList.add("dragover");
  });
  dragDropArea.addEventListener("dragleave", () => {
    dragDropArea.classList.remove("dragover");
  });
  dragDropArea.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDropArea.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) {
      handleSelectedFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleSelectedFile(e.target.files[0]);
    }
  });

  document.getElementById("remove-file-btn").addEventListener("click", removeSelectedFile);

  // 既存附件刪除按鈕
  document.getElementById("delete-existing-att-btn").addEventListener("click", handleDeleteExistingAttachment);

  // 提交記帳表單
  document.getElementById("add-transaction-form").addEventListener("submit", handleFormSubmit);

  // 導覽選單 Tab 切換
  const navBtns = document.querySelectorAll(".nav-btn");
  navBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      switchTab(tab);
    });
  });

  // 匯出報表按鈕
  document.getElementById("export-report-btn").addEventListener("click", exportHTMLReport);

  // 合約 Modal 相關控制
  const contractModal = document.getElementById("add-contract-modal");
  document.getElementById("open-contract-modal-btn").addEventListener("click", () => {
    document.getElementById("con-start-date").value = new Date().toISOString().split("T")[0];
    contractModal.classList.add("open");
  });

  const closeContractModal = () => {
    contractModal.classList.remove("open");
    document.getElementById("add-contract-form").reset();
  };
  document.getElementById("close-contract-modal-btn").addEventListener("click", closeContractModal);
  document.getElementById("cancel-contract-modal-btn").addEventListener("click", closeContractModal);

  // 合約類型切換顯示不同欄位
  const conTypeSelect = document.getElementById("con-type");
  conTypeSelect.addEventListener("change", () => {
    const isLoan = conTypeSelect.value === "房貸";
    document.querySelectorAll(".loan-field").forEach(el => el.classList.toggle("hidden", !isLoan));
    document.querySelectorAll(".lease-field").forEach(el => el.classList.toggle("hidden", isLoan));
    document.getElementById("con-amount-label").innerText = isLoan ? "貸款總額 *" : "月租金 *";
  });

  // 提交新增合約
  document.getElementById("add-contract-form").addEventListener("submit", handleContractSubmit);

  // 攤還期數 Modal 控制
  const scheduleModal = document.getElementById("edit-schedule-modal");
  const closeScheduleModal = () => scheduleModal.classList.remove("open");
  document.getElementById("close-schedule-modal-btn").addEventListener("click", closeScheduleModal);
  document.getElementById("cancel-schedule-modal-btn").addEventListener("click", closeScheduleModal);
  document.getElementById("edit-schedule-form").addEventListener("submit", handleScheduleSubmit);

  // 關閉圖片檢視器
  const viewerModal = document.getElementById("image-viewer-modal");
  viewerModal.addEventListener("click", () => {
    viewerModal.classList.remove("open");
  });
}

// 分頁切換函式
function switchTab(tabName) {
  appState.activeTab = tabName;
  
  // 更新 Nav 標籤狀態
  document.querySelectorAll(".nav-btn").forEach(btn => {
    if (btn.getAttribute("data-tab") === tabName) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // 切換視圖顯示
  document.querySelectorAll(".tab-content").forEach(content => {
    content.classList.remove("active");
  });
  const target = document.getElementById(`tab-${tabName}`);
  if (target) target.classList.add("active");
}

// 根據類型與期別動態更新類別選項
function updateCategoryOptions() {
  const type = document.getElementById("tx-type").value;
  const stage = document.getElementById("tx-stage").value;
  const categorySelect = document.getElementById("tx-category");

  categorySelect.innerHTML = "";

  const options = CATEGORY_MAP[type][stage] || [];
  options.forEach(opt => {
    const el = document.createElement("option");
    el.value = opt;
    el.innerText = opt;
    categorySelect.appendChild(el);
  });
}

// 處理選取的圖片檔案並轉成 Base64 預覽 (不限制尺寸，保留原圖)
function handleSelectedFile(file) {
  if (!file.type.startsWith("image/")) {
    alert("目前僅支援上傳圖片檔案 (如收據照片、截圖)");
    return;
  }

  appState.selectedFileName = file.name;

  const reader = new FileReader();
  reader.onload = (e) => {
    appState.selectedFileBase64 = e.target.result;

    // 顯示預覽
    document.getElementById("drag-drop-area").classList.add("hidden");
    const previewContainer = document.getElementById("file-preview-container");
    previewContainer.classList.remove("hidden");
    document.getElementById("file-preview-img").src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removeSelectedFile(e) {
  if (e) e.stopPropagation();
  appState.selectedFileBase64 = null;
  appState.selectedFileName = null;
  document.getElementById("tx-file").value = "";
  document.getElementById("file-preview-container").classList.add("hidden");
  document.getElementById("drag-drop-area").classList.remove("hidden");
}

// 提交交易表單
async function handleFormSubmit(e) {
  e.preventDefault();

  const txId = document.getElementById("tx-id").value;
  const date = document.getElementById("tx-date").value;
  const type = document.getElementById("tx-type").value;
  const payer = document.getElementById("tx-payer").value;
  const amount = parseFloat(document.getElementById("tx-amount").value);
  const stage = document.getElementById("tx-stage").value;
  const category = document.getElementById("tx-category").value;
  const description = document.getElementById("tx-desc").value;

  if (!date || !amount) {
    alert("請填寫必要欄位。");
    return;
  }

  showLoading(true);

  let txResult;

  if (txId) {
    // 編輯模式
    txResult = await callAPI("updateTransaction", {
      id: txId,
      date: date,
      type: type,
      payer: payer,
      amount: amount,
      stage: stage,
      category: category,
      description: description
    });
  } else {
    // 新增模式
    txResult = await callAPI("addTransaction", {
      date: date,
      type: type,
      payer: payer,
      amount: amount,
      stage: stage,
      category: category,
      description: description
    });
  }

  if (txResult && txResult.id) {
    // 2. 若有選擇新收據照片，則刪除舊有的並上傳新照片
    if (appState.selectedFileBase64) {
      if (txId) {
        // 先刪除舊附件
        await callAPI("deleteAttachment", { transactionId: txId });
      }
      await callAPI("uploadAttachment", {
        transactionId: txResult.id,
        base64Data: appState.selectedFileBase64,
        filename: appState.selectedFileName
      });
    }

    // 關閉 Modal 並重新載入最新資料
    document.getElementById("add-modal").classList.remove("open");
    resetAddForm();
    await fetchData();
  } else {
    showLoading(false);
  }
}


// 重設表單狀態
function resetAddForm() {
  document.getElementById("tx-id").value = "";
  document.getElementById("modal-title-text").innerHTML = `<i class="fa-solid fa-file-invoice-dollar"></i> 新增交易紀錄`;
  document.getElementById("add-transaction-form").reset();
  removeSelectedFile();

  // 確保共同帳戶選單選項顯示正常
  const payerSelect = document.getElementById("tx-payer");
  const jointOption = payerSelect.querySelector('option[value="共同帳戶"]');
  if (jointOption) jointOption.style.display = "";

  // 隱藏既存附件區
  document.getElementById("existing-attachment-area").classList.add("hidden");
  document.getElementById("drag-drop-area").classList.remove("hidden");

  // 恢復預設欄位文字
  document.getElementById("payer-label").innerHTML = `經手人/付(收)款人 <span class="required">*</span>`;
}

// 應用篩選與搜尋
function applyFilters() {
  const stageFilter = document.getElementById("filter-stage").value;
  const typeFilter = document.getElementById("filter-type").value;
  const searchText = document.getElementById("search-desc").value.toLowerCase();

  const filtered = appState.transactions.filter(tx => {
    const matchStage = stageFilter === "all" || tx.stage === stageFilter;
    const matchType = typeFilter === "all" || tx.type === typeFilter;
    const matchSearch = tx.description.toLowerCase().includes(searchText) ||
      tx.category.toLowerCase().includes(searchText) ||
      (tx.payer === "A" ? "joanna" : "elaine").includes(searchText);

    return matchStage && matchType && matchSearch;
  });

  renderTransactions(filtered);
}

// 放大檢視收據圖片
function openImageViewer(url) {
  const modal = document.getElementById("image-viewer-modal");
  const img = document.getElementById("viewer-img");
  img.src = url;
  modal.classList.add("open");
}

// --- 控制 Loading 遮罩 ---
function showLoading(show) {
  const overlay = document.getElementById("loading-overlay");
  if (show) {
    overlay.classList.remove("hidden");
    overlay.classList.remove("fade-out");
  } else {
    overlay.classList.add("fade-out");
    setTimeout(() => overlay.classList.add("hidden"), 500);
  }
}

// --- 登出 ---
function logout() {
  localStorage.removeItem("ifms_id_token");
  appState.idToken = null;
  appState.userProfile = null;
  appState.dashboard = null;
  appState.transactions = [];

  document.getElementById("app-container").classList.add("hidden");
  document.getElementById("login-container").classList.remove("hidden");

  // 重新渲染登入鈕
  google.accounts.id.disableAutoSelect();
}

// --- 編輯交易相關前端輔助函式 ---

function openEditModal(tx) {
  resetAddForm();

  // 設定編輯狀態
  document.getElementById("tx-id").value = tx.id;
  document.getElementById("modal-title-text").innerHTML = `<i class="fa-solid fa-pen-to-square"></i> 編輯交易紀錄`;

  // 填充表單
  document.getElementById("tx-date").value = tx.date;
  document.getElementById("tx-type").value = tx.type;

  // 觸發顯示與標籤邏輯
  const payerSelect = document.getElementById("tx-payer");
  const jointOption = payerSelect.querySelector('option[value="共同帳戶"]');
  const payerLabel = document.getElementById("payer-label");

  if (tx.type === "沖帳" || tx.type === "存入共同帳戶" || tx.type === "從共同帳戶借支") {
    if (jointOption) jointOption.style.display = "none";
  } else {
    if (jointOption) jointOption.style.display = "";
  }

  if (tx.type === "沖帳") {
    payerLabel.innerHTML = `付款方 <span class="required">*</span>`;
  } else if (tx.type === "存入共同帳戶") {
    payerLabel.innerHTML = `存入人 <span class="required">*</span>`;
  } else if (tx.type === "從共同帳戶借支") {
    payerLabel.innerHTML = `借支人 <span class="required">*</span>`;
  } else {
    payerLabel.innerHTML = `經手人/付(收)款人 <span class="required">*</span>`;
  }

  document.getElementById("tx-payer").value = tx.payer;
  document.getElementById("tx-amount").value = tx.amount;
  document.getElementById("tx-stage").value = tx.stage;

  // 更新費用類別下拉清單並選擇對應值
  updateCategoryOptions();
  document.getElementById("tx-category").value = tx.category;

  document.getElementById("tx-desc").value = tx.description || "";

  // 處理收據圖片
  if (tx.attachments && tx.attachments.length > 0) {
    document.getElementById("existing-attachment-area").classList.remove("hidden");
    document.getElementById("drag-drop-area").classList.add("hidden");
    
    // 取得檔名（如果是 Drive url，顯示收據圖檔提示）
    document.getElementById("existing-file-name").innerText = "已上傳收據照片";
  }

  // 開啟 Modal
  document.getElementById("add-modal").classList.add("open");
}

// --- Phase 2 渲染與控制邏輯 ---

function renderLoanSummary() {
  const summary = appState.loanSummary;
  const container = document.getElementById("loan-summary-body");
  const badge = document.getElementById("loan-status-badge");

  if (!summary || !summary.hasLoan) {
    badge.innerText = "無房貸合約";
    badge.className = "badge";
    container.innerHTML = `<p class="text-muted" style="padding: 10px 0;">目前無生效中的房貸合約。若有新增房貸，請至「合約管理」進行登記。</p>`;
    return;
  }

  const formatCurrency = (val) => "$" + Math.round(val).toLocaleString();
  badge.innerText = "還款中";
  badge.className = "badge success";

  const percent = summary.totalPeriods > 0 ? Math.round((summary.paidPeriods / summary.totalPeriods) * 100) : 0;
  const nextPaymentHtml = summary.nextPayment ? `
    <div class="loan-metric-item" style="grid-column: 1 / -1; background: rgba(16, 185, 129, 0.05); border-color: rgba(16, 185, 129, 0.2);">
      <span style="color: var(--sage-green-hover); font-weight: 600;">下期繳款日 (第 ${summary.nextPayment.period} 期)</span>
      <strong style="font-size: 1.2rem;">${summary.nextPayment.date} &nbsp;|&nbsp; 應繳本息：${formatCurrency(summary.nextPayment.monthlyPayment)}</strong>
      <div style="font-size: 0.75rem; color: var(--text-card-muted); margin-top: 4px;">
        (償還本金：${formatCurrency(summary.nextPayment.principal)} / 支付利息：${formatCurrency(summary.nextPayment.interest)})
      </div>
    </div>
  ` : `<div class="loan-metric-item" style="grid-column: 1 / -1;"><span style="color:var(--sage-green);">房貸已全部結清！</span></div>`;

  container.innerHTML = `
    <div class="loan-metric-row">
      <div class="loan-metric-item">
        <span>房貸總金額</span>
        <strong>${formatCurrency(summary.amount)}</strong>
      </div>
      <div class="loan-metric-item">
        <span>剩餘本金餘額</span>
        <strong style="color: var(--accent-rose-hover);">${formatCurrency(summary.remainingPrincipal)}</strong>
      </div>
      <div class="loan-metric-item">
        <span>當前年利率 / 寬限期</span>
        <strong>${summary.interestRate * 100}% (${summary.graceMonths}個月)</strong>
      </div>
      <div class="loan-metric-item">
        <span>還款進度</span>
        <strong>${summary.paidPeriods} / ${summary.totalPeriods} 期 (${percent}%)</strong>
      </div>
      ${nextPaymentHtml}
    </div>
    <div class="loan-progress-container">
      <div class="loan-progress-labels">
        <span>已還款比例 (${percent}%)</span>
        <span>剩餘未還 ${100 - percent}%</span>
      </div>
      <div class="loan-progress-track">
        <div class="loan-progress-fill" style="width: ${percent}%;"></div>
      </div>
    </div>
  `;
}

function renderCashFlowForecast() {
  const forecast = appState.cashflowForecast;
  const container = document.getElementById("cashflow-chart-container");

  if (!forecast || forecast.length === 0) {
    container.innerHTML = `<div class="text-center text-muted" style="padding: 20px;">無預測數據</div>`;
    return;
  }

  const formatCurrency = (val) => "$" + Math.round(val).toLocaleString();
  
  // 找出最高金額以設定柱狀圖比例
  let maxAmount = 1;
  forecast.forEach(f => {
    if (f.income > maxAmount) maxAmount = f.income;
    if (f.expense > maxAmount) maxAmount = f.expense;
  });

  let html = "";
  forecast.forEach(f => {
    const incHeight = Math.round((f.income / maxAmount) * 110);
    const expHeight = Math.round((f.expense / maxAmount) * 110);

    html += `
      <div class="cashflow-month-group">
        <div class="cashflow-bars">
          <div class="cashflow-bar income-bar" style="height: ${Math.max(4, incHeight)}px;" title="預期租金收入: ${formatCurrency(f.income)}"></div>
          <div class="cashflow-bar expense-bar" style="height: ${Math.max(4, expHeight)}px;" title="預期房貸支出: ${formatCurrency(f.expense)}"></div>
        </div>
        <div class="cashflow-month-label">${f.month.substring(5)}月</div>
        <div style="font-size: 0.65rem; color: ${f.net >= 0 ? "var(--sage-green)" : "var(--accent-rose)"}; margin-top:2px; font-weight:600;">
          ${f.net >= 0 ? "+" : ""}${Math.round(f.net / 1000)}k
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function renderContracts() {
  const grid = document.getElementById("contracts-grid");
  const contracts = appState.contracts;

  if (!contracts || contracts.length === 0) {
    grid.innerHTML = `
      <div class="card text-center text-muted" style="grid-column: 1/-1; padding: 40px;">
        目前尚無合約紀錄，點擊右上角「新增合約紀錄」進行建立。
      </div>
    `;
    return;
  }

  const formatCurrency = (val) => "$" + Math.round(val).toLocaleString();

  grid.innerHTML = contracts.map(c => {
    const isLoan = c.type === "房貸";
    const detailsHtml = isLoan ? `
      <div class="p-row"><span>貸款金額：</span><strong>${formatCurrency(c.amount)}</strong></div>
      <div class="p-row"><span>年利率：</span><strong>${c.interestRate * 100}%</strong></div>
      <div class="p-row"><span>期限 / 寬限期：</span><strong>${c.termMonths}期 (${c.graceMonths}月寬限)</strong></div>
      <div class="p-row"><span>每月還款日：</span><strong>每月 ${c.payDay} 日</strong></div>
    ` : `
      <div class="p-row"><span>月租金：</span><strong>${formatCurrency(c.amount)}</strong></div>
      <div class="p-row"><span>租期起訖：</span><strong>${c.startDate} ~ ${c.endDate || "未填"}</strong></div>
      <div class="p-row"><span>每月繳租日 / 押金：</span><strong>${c.payDay}日 / ${formatCurrency(c.deposit)}</strong></div>
      <div class="p-row"><span>仲介服務費：</span><strong>${formatCurrency(c.brokerCommission)}</strong></div>
    `;

    const viewScheduleBtn = isLoan ? `<button class="btn-secondary btn-view-schedule" data-id="${c.id}"><i class="fa-solid fa-calendar-days"></i> 查看攤還表</button>` : "";
    const pdfLink = c.fileUrl ? `<a href="${c.fileUrl}" target="_blank" class="btn-secondary" style="text-decoration:none;"><i class="fa-solid fa-file-pdf"></i> 合約檔</a>` : "";

    return `
      <div class="card contract-card ${isLoan ? 'loan' : 'lease'}">
        <div class="contract-title">
          <h4>${c.name}</h4>
          <span class="tx-badge ${isLoan ? 'recon' : 'income'}">${c.type}</span>
        </div>
        <div class="p-details">
          ${detailsHtml}
        </div>
        <div class="contract-actions">
          ${viewScheduleBtn}
          ${pdfLink}
          <button class="btn-delete-att btn-delete-contract" data-id="${c.id}">刪除</button>
        </div>
      </div>
    `;
  }).join("");

  // 綁定「查看攤還表」與「刪除合約」事件
  grid.querySelectorAll(".btn-view-schedule").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      loadAndRenderLoanSchedule(id);
    });
  });

  grid.querySelectorAll(".btn-delete-contract").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (confirm("確定要刪除此合約紀錄嗎？這會同時刪除相關攤還表！")) {
        showLoading(true);
        await callAPI("deleteContract", { id: id });
        await fetchData();
      }
    });
  });
}

async function loadAndRenderLoanSchedule(contractId) {
  showLoading(true);
  const items = await callAPI("getLoanSchedule", { contractId: contractId });
  showLoading(false);

  const section = document.getElementById("loan-schedule-section");
  const tbody = document.getElementById("loan-schedule-body");

  if (!items || items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">此合約尚無攤還表細目</td></tr>`;
    section.classList.remove("hidden");
    return;
  }

  const formatCurrency = (val) => "$" + Math.round(val).toLocaleString();

  tbody.innerHTML = items.map(item => `
    <tr>
      <td>第 ${item.period} 期</td>
      <td>${item.paymentDate}</td>
      <td class="td-amount expense">${formatCurrency(item.monthlyPayment)}</td>
      <td>${formatCurrency(item.principal)}</td>
      <td>${formatCurrency(item.interest)}</td>
      <td>${formatCurrency(item.remainingPrincipal)}</td>
      <td><span class="tx-badge ${item.status === '已繳' ? 'income' : 'expense'}">${item.status}</span></td>
      <td><button class="btn-edit btn-edit-schedule" data-item='${JSON.stringify(item)}'><i class="fa-solid fa-pen"></i> 編輯</button></td>
    </tr>
  `).join("");

  section.classList.remove("hidden");

  // 綁定編輯單期事件
  tbody.querySelectorAll(".btn-edit-schedule").forEach(btn => {
    btn.addEventListener("click", () => {
      const item = JSON.parse(btn.getAttribute("data-item"));
      openScheduleEditModal(item);
    });
  });
}

function openScheduleEditModal(item) {
  document.getElementById("sch-id").value = item.id;
  document.getElementById("sch-period").value = `第 ${item.period} 期 (${item.paymentDate})`;
  document.getElementById("sch-status").value = item.status;
  document.getElementById("sch-payment").value = item.monthlyPayment;
  document.getElementById("sch-principal").value = item.principal;
  document.getElementById("sch-interest").value = item.interest;

  document.getElementById("edit-schedule-modal").classList.add("open");
}

async function handleScheduleSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("sch-id").value;
  const status = document.getElementById("sch-status").value;
  const monthlyPayment = parseFloat(document.getElementById("sch-payment").value);
  const principal = parseFloat(document.getElementById("sch-principal").value);
  const interest = parseFloat(document.getElementById("sch-interest").value);

  showLoading(true);
  await callAPI("updateLoanPeriod", {
    id: id,
    status: status,
    monthlyPayment: monthlyPayment,
    principal: principal,
    interest: interest
  });

  document.getElementById("edit-schedule-modal").classList.remove("open");
  await fetchData();
}

async function handleContractSubmit(e) {
  e.preventDefault();

  const type = document.getElementById("con-type").value;
  const name = document.getElementById("con-name").value;
  const amount = parseFloat(document.getElementById("con-amount").value);
  const startDate = document.getElementById("con-start-date").value;
  const payDay = parseInt(document.getElementById("con-pay-day").value);
  const fileUrl = document.getElementById("con-file-url").value;

  const payload = {
    type: type,
    name: name,
    amount: amount,
    startDate: startDate,
    payDay: payDay,
    fileUrl: fileUrl
  };

  if (type === "房貸") {
    payload.interestRate = parseFloat(document.getElementById("con-rate").value) / 100;
    payload.termMonths = parseInt(document.getElementById("con-term").value);
    payload.graceMonths = parseInt(document.getElementById("con-grace").value) || 0;
  } else {
    payload.endDate = document.getElementById("con-end-date").value;
    payload.deposit = parseFloat(document.getElementById("con-deposit").value) || 0;
    payload.brokerCommission = parseFloat(document.getElementById("con-commission").value) || 0;
  }

  showLoading(true);
  const res = await callAPI("addContract", payload);
  if (res && res.id) {
    document.getElementById("add-contract-modal").classList.remove("open");
    document.getElementById("add-contract-form").reset();
    await fetchData();
  } else {
    showLoading(false);
  }
}

// 匯出 HTML 列印與核對報表
function exportHTMLReport() {
  const db = appState.dashboard;
  const txs = appState.transactions;
  if (!db || !txs) {
    alert("尚無資料可供匯出。");
    return;
  }

  const formatCurrency = (val) => "$" + Math.round(val).toLocaleString();
  const dateStr = new Date().toLocaleDateString('zh-TW');

  let txRowsHtml = "";
  txs.forEach(tx => {
    txRowsHtml += `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${tx.date}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${tx.type}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${tx.stage}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${tx.category}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${tx.payer === "A" ? "Joanna" : (tx.payer === "B" ? "Elaine" : "共同帳戶")}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; text-align: right;">${formatCurrency(tx.amount)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${tx.description || ""}</td>
      </tr>
    `;
  });

  const htmlContent = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <title>房產投資財務管理系統 - 結算報告 (${dateStr})</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #1e293b; background: #fff; line-height: 1.6; }
    h1 { color: #0f172a; border-bottom: 2px solid #10b981; padding-bottom: 10px; }
    .meta-box { background: #f8fafc; padding: 15px 20px; border-radius: 8px; margin: 20px 0; display: flex; justify-content: space-between; }
    .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 20px 0; }
    .metric-card { background: #f1f5f9; padding: 15px; border-radius: 8px; text-align: center; }
    .metric-card span { font-size: 0.85rem; color: #64748b; }
    .metric-card h3 { font-size: 1.4rem; margin-top: 5px; color: #0f172a; }
    .partners-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
    .partner-card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 20px; }
    .p-row { display: flex; justify-content: space-between; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th { background: #0f172a; color: #fff; padding: 12px 10px; text-align: left; font-size: 0.9rem; }
    .print-btn { background: #10b981; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 1rem; margin-bottom: 20px; }
    @media print { .print-btn { display: none; } }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">列印 / 另存為 PDF</button>
  <h1>房產投資合夥財務管理系統 - 結算報告</h1>
  <div class="meta-box">
    <div><strong>報表產出日期：</strong> ${dateStr}</div>
    <div><strong>合夥人：</strong> Joanna (50%) & Elaine (50%)</div>
  </div>

  <h2>一、 財務指標總覽</h2>
  <div class="metrics-grid">
    <div class="metric-card"><span>累積投入總支出</span><h3>${formatCurrency(db.summary.totalExpense)}</h3></div>
    <div class="metric-card"><span>累積租金/其他收入</span><h3>${formatCurrency(db.summary.totalIncome)}</h3></div>
    <div class="metric-card"><span>房產淨投入成本</span><h3>${formatCurrency(db.summary.netCost)}</h3></div>
    <div class="metric-card"><span>華南共同帳戶餘額</span><h3>${formatCurrency(db.summary.jointCash)}</h3></div>
  </div>

  <h2>二、 雙方結算對帳單</h2>
  <div class="partners-grid">
    <div class="partner-card">
      <h3>Joanna 對帳單</h3>
      <div class="p-row"><span>實際支出代墊：</span><strong>${formatCurrency(db.partners.A.paid)}</strong></div>
      <div class="p-row"><span>應分攤支出：</span><strong>${formatCurrency(db.partners.A.shouldPay)}</strong></div>
      <div class="p-row"><span>實際收到收入：</span><strong>${formatCurrency(db.partners.A.received)}</strong></div>
      <div class="p-row"><span>應分攤收入：</span><strong>${formatCurrency(db.partners.A.shouldGet)}</strong></div>
      <div class="p-row"><span>預存共同帳戶：</span><strong>${formatCurrency(db.partners.A.deposit)}</strong></div>
      <div class="p-row"><span>共同帳戶借支：</span><strong>${formatCurrency(db.partners.A.borrow)}</strong></div>
      <hr>
      <div class="p-row"><span>代墊淨額：</span><strong>${db.partners.A.netAdvance > 0 ? "多代墊 " + formatCurrency(db.partners.A.netAdvance) : (db.partners.A.netAdvance < 0 ? "需補足 " + formatCurrency(Math.abs(db.partners.A.netAdvance)) : "已結清 0")}</strong></div>
    </div>
    <div class="partner-card">
      <h3>Elaine 對帳單</h3>
      <div class="p-row"><span>實際支出代墊：</span><strong>${formatCurrency(db.partners.B.paid)}</strong></div>
      <div class="p-row"><span>應分攤支出：</span><strong>${formatCurrency(db.partners.B.shouldPay)}</strong></div>
      <div class="p-row"><span>實際收到收入：</span><strong>${formatCurrency(db.partners.B.received)}</strong></div>
      <div class="p-row"><span>應分攤收入：</span><strong>${formatCurrency(db.partners.B.shouldGet)}</strong></div>
      <div class="p-row"><span>預存共同帳戶：</span><strong>${formatCurrency(db.partners.B.deposit)}</strong></div>
      <div class="p-row"><span>共同帳戶借支：</span><strong>${formatCurrency(db.partners.B.borrow)}</strong></div>
      <hr>
      <div class="p-row"><span>代墊淨額：</span><strong>${db.partners.B.netAdvance > 0 ? "多代墊 " + formatCurrency(db.partners.B.netAdvance) : (db.partners.B.netAdvance < 0 ? "需補足 " + formatCurrency(Math.abs(db.partners.B.netAdvance)) : "已結清 0")}</strong></div>
    </div>
  </div>

  <h2>三、 完整交易明細紀錄 (${txs.length} 筆)</h2>
  <table>
    <thead>
      <tr>
        <th>日期</th>
        <th>類型</th>
        <th>期別</th>
        <th>類別</th>
        <th>經手/付款人</th>
        <th style="text-align: right;">金額</th>
        <th>備註</th>
      </tr>
    </thead>
    <tbody>
      ${txRowsHtml}
    </tbody>
  </table>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `IFMS_財務結算報表_${dateStr.replace(/\//g, "-")}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function handleDeleteExistingAttachment() {
  const txId = document.getElementById("tx-id").value;
  if (!txId) return;

  if (confirm("確認要刪除目前的收據附件嗎？此動作將會從您的 Google Drive 中刪除該圖片檔案。")) {
    showLoading(true);
    const result = await callAPI("deleteAttachment", { transactionId: txId });
    showLoading(false);
    if (result && result.success) {
      alert("附件刪除成功！");
      document.getElementById("existing-attachment-area").classList.add("hidden");
      document.getElementById("drag-drop-area").classList.remove("hidden");
    } else {
      // 就算 Sheets 沒有關聯，也隱藏 UI 讓使用者可以重新上傳
      document.getElementById("existing-attachment-area").classList.add("hidden");
      document.getElementById("drag-drop-area").classList.remove("hidden");
    }
  }
}
