// 房產投資合夥財務管理系統 (IFMS) - 後端 Apps Script
// 部署為 Web App，以 Anyone 存取，執行身分為 "Me"

const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet() ? SpreadsheetApp.getActiveSpreadsheet().getId() : "";

// --- API 入口 ---

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "ok",
    message: "IFMS Apps Script API is running.",
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const requestData = JSON.parse(e.postData.contents);
    const action = requestData.action;
    const idToken = requestData.idToken;

    // 1. 驗證 Google ID Token 與白名單
    const userEmail = verifyToken(idToken);
    if (!userEmail) {
      return errorResponse("驗證失敗，存取遭拒。");
    }

    // 2. 根據 action 路由
    let result;
    switch (action) {
      case "getDashboard":
        result = getDashboardData();
        break;
      case "getTransactions":
        result = getTransactionsList();
        break;
      case "addTransaction":
        result = addTransactionItem(requestData.data, userEmail);
        break;
      case "updateTransaction":
        result = updateTransactionItem(requestData.data, userEmail);
        break;
      case "deleteAttachment":
        result = deleteTransactionAttachment(requestData.data.transactionId);
        break;
      case "uploadAttachment":
        result = uploadAttachmentFile(requestData.data, userEmail);
        break;
      case "getContracts":
        result = getContractsList();
        break;
      case "addContract":
        result = addContractItem(requestData.data, userEmail);
        break;
      case "deleteContract":
        result = deleteContractItem(requestData.data.id);
        break;
      case "getLoanSummary":
        result = getLoanSummaryData();
        break;
      case "getCashFlowForecast":
        result = getCashFlowForecastData();
        break;
      case "getLoanSchedule":
        result = getLoanScheduleItems(requestData.data.contractId);
        break;
      case "updateLoanPeriod":
        result = updateLoanPeriodItem(requestData.data);
        break;
      default:
        return errorResponse("未知的操作指令。");
    }

    return successResponse(result);

  } catch (error) {
    return errorResponse(error.toString());
  }
}

// --- 輔助函式：回應格式 ---

function successResponse(data) {
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    data: data
  })).setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(message) {
  return ContentService.createTextOutput(JSON.stringify({
    success: false,
    message: message
  })).setMimeType(ContentService.MimeType.JSON);
}

// --- 核心邏輯：身分驗證 ---

function verifyToken(idToken) {
  if (!idToken) return null;
  
  // 本地開發與首次測試若無 Token 可於 Users 表單中設定一個測試機制，此處使用 Google 驗證端點
  try {
    const url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + idToken;
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const json = JSON.parse(response.getContentText());
    
    if (json.email) {
      const email = json.email.toLowerCase();
      if (isUserAllowed(email)) {
        return email;
      }
    }
  } catch (e) {
    Logger.log("Token verification error: " + e.toString());
  }
  return null;
}

function isUserAllowed(email) {
  const sheet = getSheetByName("Users");
  const data = sheet.getDataRange().getValues();
  // 第一列是標頭，資料從第二列開始
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().toLowerCase() === email) {
      return true;
    }
  }
  return false;
}

// --- 核心邏輯：資料表操作與計算 ---

function getSheetByName(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    // 自動建立基本標頭
    setupSheetHeaders(sheet, name);
  }
  return sheet;
}

function setupSheetHeaders(sheet, name) {
  const headers = {
    "Users": ["email", "name", "role"],
    "ShareRatioHistory": ["id", "effective_date", "ratio_a", "ratio_b"],
    "Transactions": ["id", "date", "amount", "category", "stage", "payer", "type", "description", "created_at", "created_by"],
    "Attachments": ["id", "transaction_id", "drive_file_id", "file_url", "uploaded_at", "uploaded_by"],
    "Contracts": ["id", "type", "name", "amount", "start_date", "end_date", "pay_day", "interest_rate", "term_months", "grace_months", "deposit", "broker_commission", "file_url", "status", "created_at", "created_by"],
    "LoanSchedule": ["id", "contract_id", "period", "payment_date", "monthly_payment", "principal", "interest", "remaining_principal", "status", "transaction_id"]
  };
  if (headers[name]) {
    sheet.appendRow(headers[name]);
  }
}

// 取得出資比例歷史，並依生效日期由新到舊排序
function getShareRatioHistory() {
  const sheet = getSheetByName("ShareRatioHistory");
  const data = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    list.push({
      effectiveDate: new Date(data[i][1]),
      ratioA: parseFloat(data[i][2]) || 0.5,
      ratioB: parseFloat(data[i][3]) || 0.5
    });
  }
  // 如果沒有歷史設定，給予預設的 50:50
  if (list.length === 0) {
    list.push({
      effectiveDate: new Date("2000-01-01"),
      ratioA: 0.5,
      ratioB: 0.5
    });
  }
  // 由新到舊排序
  list.sort((a, b) => b.effectiveDate - a.effectiveDate);
  return list;
}

// 取得特定日期的出資比例
function getRatioForDate(dateStr, ratioHistory) {
  const date = new Date(dateStr);
  for (let history of ratioHistory) {
    if (date >= history.effectiveDate) {
      return history;
    }
  }
  return ratioHistory[ratioHistory.length - 1]; // 最早的一筆
}

// 取得明細與關聯附件
function getTransactionsList() {
  const txSheet = getSheetByName("Transactions");
  const txData = txSheet.getDataRange().getValues();
  
  const attSheet = getSheetByName("Attachments");
  const attData = attSheet.getDataRange().getValues();
  
  // 建立附件的 Lookup Map: transaction_id -> array of fileUrls (直連下載/預覽格式)
  const attMap = {};
  for (let i = 1; i < attData.length; i++) {
    const txId = attData[i][1];
    const fileId = attData[i][2];
    const fileUrl = attData[i][3];
    const directUrl = fileId ? "https://drive.google.com/uc?export=view&id=" + fileId : fileUrl;
    if (txId) {
      if (!attMap[txId]) attMap[txId] = [];
      attMap[txId].push(directUrl);
    }
  }
  
  const list = [];
  for (let i = 1; i < txData.length; i++) {
    const id = txData[i][0];
    list.push({
      id: id,
      date: formatDate(txData[i][1]),
      amount: parseFloat(txData[i][2]) || 0,
      category: txData[i][3],
      stage: txData[i][4],
      payer: txData[i][5],
      type: txData[i][6],
      description: txData[i][7],
      createdAt: txData[i][8],
      createdBy: txData[i][9],
      attachments: attMap[id] || []
    });
  }
  
  // 依交易日期倒序
  list.sort((a, b) => new Date(b.date) - new Date(a.date));
  return list;
}

// 計算 Dashboard 各項總計與結算
function getDashboardData() {
  const txSheet = getSheetByName("Transactions");
  const txData = txSheet.getDataRange().getValues();
  const ratioHistory = getShareRatioHistory();
  
  let totalExpense = 0;
  let totalIncome = 0;
  
  // 各期別小計
  const stageExpenses = { "前期": 0, "中期": 0, "後期": 0 };
  const stageIncomes = { "前期": 0, "中期": 0, "後期": 0 };
  
  // 雙方各自實付與應付累計
  let paidByA = 0;
  let paidByB = 0;
  let shouldPayA = 0;
  let shouldPayB = 0;
  
  // 雙方各自收到的收入與應得累計
  let receivedByA = 0;
  let receivedByB = 0;
  let shouldGetA = 0;
  let shouldGetB = 0;
  
  // 雙方沖帳與共同帳戶相關累計
  let reconPaidByA = 0;  // A 支付給 B 的沖帳金額
  let reconPaidByB = 0;  // B 支付給 A 的沖帳金額
  let depositByA = 0;    // A 存入共同帳戶的金額
  let depositByB = 0;    // B 存入共同帳戶的金額
  let borrowByA = 0;     // A 從共同帳戶借支的金額
  let borrowByB = 0;     // B 從共同帳戶借支的金額
  let jointExpense = 0;  // 共同帳戶付出的支出
  let jointIncome = 0;   // 共同帳戶收到的收入

  for (let i = 1; i < txData.length; i++) {
    const date = formatDate(txData[i][1]);
    const amount = parseFloat(txData[i][2]) || 0;
    const stage = txData[i][4];
    const payer = txData[i][5]; // A, B, 或 共同帳戶
    const type = txData[i][6]; // 支出 / 收入 / 沖帳 / 存入共同帳戶
    
    const ratio = getRatioForDate(date, ratioHistory);
    
    if (type === "支出") {
      totalExpense += amount;
      if (stageExpenses[stage] !== undefined) {
        stageExpenses[stage] += amount;
      }
      
      if (payer === "A") {
        paidByA += amount;
      } else if (payer === "B") {
        paidByB += amount;
      } else if (payer === "共同帳戶") {
        jointExpense += amount;
      }
      
      shouldPayA += amount * ratio.ratioA;
      shouldPayB += amount * ratio.ratioB;
      
    } else if (type === "收入") {
      totalIncome += amount;
      if (stageIncomes[stage] !== undefined) {
        stageIncomes[stage] += amount;
      }
      
      if (payer === "A") {
        receivedByA += amount;
      } else if (payer === "B") {
        receivedByB += amount;
      } else if (payer === "共同帳戶") {
        jointIncome += amount;
      }
      
      shouldGetA += amount * ratio.ratioA;
      shouldGetB += amount * ratio.ratioB;
      
    } else if (type === "沖帳") {
      if (payer === "A") {
        reconPaidByA += amount;
      } else if (payer === "B") {
        reconPaidByB += amount;
      }
    } else if (type === "存入共同帳戶") {
      if (payer === "A") {
        depositByA += amount;
      } else if (payer === "B") {
        depositByB += amount;
      }
    } else if (type === "從共同帳戶借支") {
      if (payer === "A") {
        borrowByA += amount;
      } else if (payer === "B") {
        borrowByB += amount;
      }
    }
  }
  
  // 雙方各自帳戶代墊淨值（含個人實收、實付與存入共同帳戶的錢，扣除個人借支）
  const advanceBalanceA = (paidByA - shouldPayA) - (receivedByA - shouldGetA) + (reconPaidByA - reconPaidByB) + depositByA - borrowByA;
  const advanceBalanceB = (paidByB - shouldPayB) - (receivedByB - shouldGetB) + (reconPaidByB - reconPaidByA) + depositByB - borrowByB;
  
  // 共同帳戶餘額 = A存入 + B存入 + 共同帳戶收入 - 共同帳戶支出 - A借支 - B借支
  const jointCash = depositByA + depositByB + jointIncome - jointExpense - borrowByA - borrowByB;
  
  // 雙方對此共同餘額扣除後，真正的代墊淨額（即多出或少出自己比例部分的錢）
  const currentRatio = ratioHistory[0] || { ratioA: 0.5, ratioB: 0.5 };
  const surplusA = advanceBalanceA - jointCash * currentRatio.ratioA;
  const surplusB = advanceBalanceB - jointCash * currentRatio.ratioB;
  
  return {
    summary: {
      totalExpense: totalExpense,
      totalIncome: totalIncome,
      netCost: totalExpense - totalIncome,
      stageExpenses: stageExpenses,
      stageIncomes: stageIncomes,
      jointCash: jointCash,
      jointExpense: jointExpense,
      jointIncome: jointIncome
    },
    partners: {
      A: {
        paid: paidByA,
        shouldPay: shouldPayA,
        received: receivedByA,
        shouldGet: shouldGetA,
        reconPaid: reconPaidByA,
        deposit: depositByA,
        borrow: borrowByA,
        netAdvance: surplusA
      },
      B: {
        paid: paidByB,
        shouldPay: shouldPayB,
        received: receivedByB,
        shouldGet: shouldGetB,
        reconPaid: reconPaidByB,
        deposit: depositByB,
        borrow: borrowByB,
        netAdvance: surplusB
      }
    },
    settlement: {
      whosAdvancing: surplusA > 0.01 ? "A" : (surplusA < -0.01 ? "B" : "None"),
      amount: Math.abs(surplusA)
    },
    currentRatio: currentRatio
  };
}

// 新增交易
function addTransactionItem(item, userEmail) {
  const sheet = getSheetByName("Transactions");
  const id = "TX_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000);
  const now = new Date();
  
  sheet.appendRow([
    id,
    item.date,
    item.amount,
    item.category,
    item.stage,
    item.payer,
    item.type,
    item.description || "",
    now,
    userEmail
  ]);
  
  return { id: id };
}

// 上傳附件並存至 Google Drive
function uploadAttachmentFile(data, userEmail) {
  const transactionId = data.transactionId;
  const base64Data = data.base64Data; // 格式: data:image/png;base64,xxxx...
  const filename = data.filename;
  
  // 建立或取得 Google Drive 中的專屬資料夾
  const folder = getOrCreateAttachmentFolder();
  
  // 解析 base64
  const splitData = base64Data.split(",");
  const contentType = splitData[0].match(/:(.*?);/)[1];
  const byteCharacters = Utilities.base64Decode(splitData[1]);
  const blob = Utilities.newBlob(byteCharacters, contentType, filename);
  
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
  const fileId = file.getId();
  const fileUrl = file.getUrl();
  
  // 寫入 Attachments 資料表
  const sheet = getSheetByName("Attachments");
  const id = "ATT_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000);
  
  sheet.appendRow([
    id,
    transactionId,
    fileId,
    fileUrl,
    new Date(),
    userEmail
  ]);
  
  return {
    id: id,
    fileUrl: fileUrl
  };
}

function getOrCreateAttachmentFolder() {
  const folderName = "IFMS_Attachments";
  const folders = DriveApp.getFoldersByName(folderName);
  while (folders.hasNext()) {
    const f = folders.next();
    if (!f.isTrashed()) {
      return f;
    }
  }
  return DriveApp.createFolder(folderName);
}

// --- 實用輔助函式 ---

function formatDate(dateVal) {
  if (!dateVal) return "";
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = ("0" + (d.getMonth() + 1)).slice(-2);
  const day = ("0" + d.getDate()).slice(-2);
  return `${year}-${month}-${day}`;
}

// --- 新增：編輯交易與刪除附件相關 API ---

function updateTransactionItem(item, userEmail) {
  const sheet = getSheetByName("Transactions");
  const data = sheet.getDataRange().getValues();
  const txId = item.id;
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === txId) {
      const row = i + 1;
      sheet.getRange(row, 2).setValue(item.date);
      sheet.getRange(row, 3).setValue(item.amount);
      sheet.getRange(row, 4).setValue(item.category);
      sheet.getRange(row, 5).setValue(item.stage);
      sheet.getRange(row, 6).setValue(item.payer);
      sheet.getRange(row, 7).setValue(item.type);
      sheet.getRange(row, 8).setValue(item.description || "");
      sheet.getRange(row, 9).setValue(new Date());
      sheet.getRange(row, 10).setValue(userEmail);
      return { success: true, id: txId };
    }
  }
  throw new Error("找不到該筆交易紀錄。");
}

function deleteTransactionAttachment(transactionId) {
  const sheet = getSheetByName("Attachments");
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === transactionId) {
      const fileId = data[i][2];
      if (fileId) {
        try {
          const file = DriveApp.getFileById(fileId);
          file.setTrashed(true);
        } catch (e) {
          Logger.log("Error trashing file: " + e.toString());
        }
      }
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, message: "無此附件紀錄" };
}

// --- Phase 2: 合約管理與貸款攤還邏輯 ---

function getContractsList() {
  const sheet = getSheetByName("Contracts");
  const data = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    list.push({
      id: data[i][0],
      type: data[i][1],
      name: data[i][2],
      amount: parseFloat(data[i][3]) || 0,
      startDate: formatDate(data[i][4]),
      endDate: formatDate(data[i][5]),
      payDay: parseInt(data[i][6]) || 1,
      interestRate: parseFloat(data[i][7]) || 0,
      termMonths: parseInt(data[i][8]) || 0,
      graceMonths: parseInt(data[i][9]) || 0,
      deposit: parseFloat(data[i][10]) || 0,
      brokerCommission: parseFloat(data[i][11]) || 0,
      fileUrl: data[i][12] || "",
      status: data[i][13] || "已啟用",
      createdAt: data[i][14],
      createdBy: data[i][15]
    });
  }
  return list;
}

function addContractItem(item, userEmail) {
  const sheet = getSheetByName("Contracts");
  const id = "CON_" + new Date().getTime();
  const now = new Date();
  
  sheet.appendRow([
    id,
    item.type,
    item.name,
    item.amount,
    item.startDate,
    item.endDate || "",
    item.payDay || 1,
    item.interestRate || 0,
    item.termMonths || 0,
    item.graceMonths || 0,
    item.deposit || 0,
    item.brokerCommission || 0,
    item.fileUrl || "",
    "已啟用",
    now,
    userEmail
  ]);

  // 若為房貸合約，自動生成 LoanSchedule 攤還表
  if (item.type === "房貸" && item.amount > 0 && item.termMonths > 0) {
    generateLoanScheduleItems(
      id,
      parseFloat(item.amount),
      parseFloat(item.interestRate) || 0,
      parseInt(item.termMonths),
      parseInt(item.graceMonths) || 0,
      item.startDate,
      parseInt(item.payDay) || 1
    );
  }

  return { id: id };
}

function generateLoanScheduleItems(contractId, amount, interestRate, termMonths, graceMonths, startDateStr, payDay) {
  const sheet = getSheetByName("LoanSchedule");
  
  let remainingPrincipal = amount;
  const r = interestRate / 12; // 月利率
  const M = termMonths - graceMonths; // 本息均攤總月數
  
  // 計算寬限期後的每月均攤金額
  let pmtAfterGrace = 0;
  if (M > 0 && r > 0) {
    pmtAfterGrace = remainingPrincipal * (r * Math.pow(1 + r, M)) / (Math.pow(1 + r, M) - 1);
  } else if (M > 0) {
    pmtAfterGrace = remainingPrincipal / M;
  }

  const startD = new Date(startDateStr);
  const startYear = startD.getFullYear();
  const startMonth = startD.getMonth(); // 0-11

  const rows = [];
  for (let p = 1; p <= termMonths; p++) {
    // 計算該期繳款日
    const targetDate = new Date(startYear, startMonth + p - 1, payDay);
    const dateStr = formatDate(targetDate);
    
    let monthlyPayment = 0;
    let principal = 0;
    let interest = 0;
    
    if (p <= graceMonths) {
      // 寬限期內：只繳利息，還本為 0
      interest = Math.round(remainingPrincipal * r);
      principal = 0;
      monthlyPayment = interest;
    } else {
      // 本息攤還期
      interest = Math.round(remainingPrincipal * r);
      principal = Math.round(pmtAfterGrace - interest);
      
      // 最後一期微調尾數
      if (p === termMonths || remainingPrincipal - principal < 0) {
        principal = remainingPrincipal;
      }
      
      monthlyPayment = principal + interest;
      remainingPrincipal = Math.max(0, remainingPrincipal - principal);
    }

    const schId = "SCH_" + contractId + "_" + p;
    rows.push([
      schId,
      contractId,
      p,
      dateStr,
      monthlyPayment,
      principal,
      interest,
      remainingPrincipal,
      "未繳",
      ""
    ]);
  }

  // 寫入試算表
  if (rows.length > 0) {
    const range = sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length);
    range.setValues(rows);
  }
}

function deleteContractItem(contractId) {
  const conSheet = getSheetByName("Contracts");
  const conData = conSheet.getDataRange().getValues();
  for (let i = 1; i < conData.length; i++) {
    if (conData[i][0] === contractId) {
      conSheet.deleteRow(i + 1);
      break;
    }
  }

  // 連帶刪除對應的攤還表
  const schSheet = getSheetByName("LoanSchedule");
  const schData = schSheet.getDataRange().getValues();
  for (let i = schData.length - 1; i >= 1; i--) {
    if (schData[i][1] === contractId) {
      schSheet.deleteRow(i + 1);
    }
  }

  return { success: true };
}

function getLoanSummaryData() {
  const contracts = getContractsList();
  const loanContract = contracts.find(c => c.type === "房貸" && c.status === "已啟用");
  
  if (!loanContract) {
    return { hasLoan: false };
  }

  const schSheet = getSheetByName("LoanSchedule");
  const schData = schSheet.getDataRange().getValues();
  
  let paidPeriods = 0;
  let totalPeriods = 0;
  let nextPayment = null;
  let remainingPrincipal = loanContract.amount;

  const todayStr = formatDate(new Date());

  for (let i = 1; i < schData.length; i++) {
    if (schData[i][1] === loanContract.id) {
      totalPeriods++;
      const status = schData[i][8];
      const period = parseInt(schData[i][2]);
      const rem = parseFloat(schData[i][7]) || 0;
      
      if (status === "已繳") {
        paidPeriods++;
        remainingPrincipal = rem;
      } else if (!nextPayment && status === "未繳") {
        nextPayment = {
          period: period,
          date: formatDate(schData[i][3]),
          monthlyPayment: parseFloat(schData[i][4]) || 0,
          principal: parseFloat(schData[i][5]) || 0,
          interest: parseFloat(schData[i][6]) || 0
        };
      }
    }
  }

  return {
    hasLoan: true,
    contractId: loanContract.id,
    name: loanContract.name,
    amount: loanContract.amount,
    interestRate: loanContract.interestRate,
    termMonths: loanContract.termMonths,
    graceMonths: loanContract.graceMonths,
    startDate: loanContract.startDate,
    paidPeriods: paidPeriods,
    totalPeriods: totalPeriods,
    remainingPrincipal: remainingPrincipal,
    nextPayment: nextPayment
  };
}

function getCashFlowForecastData() {
  const months = [];
  const now = new Date();
  
  // 生成未來 6 個月份 (YYYY-MM)
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    months.push(`${yyyy}-${mm}`);
  }

  const contracts = getContractsList();
  const leaseContracts = contracts.filter(c => c.type === "租約" && c.status === "已啟用");
  
  const schSheet = getSheetByName("LoanSchedule");
  const schData = schSheet.getDataRange().getValues();

  const forecast = months.map(mStr => {
    let income = 0;
    let expense = 0;

    // 1. 計算租金流入 (檢查各有效租約)
    leaseContracts.forEach(lease => {
      if (lease.startDate && lease.endDate) {
        const leaseStartMonth = lease.startDate.substring(0, 7);
        const leaseEndMonth = lease.endDate.substring(0, 7);
        if (mStr >= leaseStartMonth && mStr <= leaseEndMonth) {
          income += lease.amount;
        }
      } else if (lease.startDate) {
        if (mStr >= lease.startDate.substring(0, 7)) {
          income += lease.amount;
        }
      }
    });

    // 2. 計算房貸本息流出 (對照 LoanSchedule)
    for (let i = 1; i < schData.length; i++) {
      const payDate = formatDate(schData[i][3]);
      if (payDate && payDate.substring(0, 7) === mStr) {
        expense += parseFloat(schData[i][4]) || 0;
      }
    }

    return {
      month: mStr,
      income: income,
      expense: expense,
      net: income - expense
    };
  });

  return forecast;
}

function getLoanScheduleItems(contractId) {
  const sheet = getSheetByName("LoanSchedule");
  const data = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === contractId) {
      list.push({
        id: data[i][0],
        contractId: data[i][1],
        period: parseInt(data[i][2]),
        paymentDate: formatDate(data[i][3]),
        monthlyPayment: parseFloat(data[i][4]) || 0,
        principal: parseFloat(data[i][5]) || 0,
        interest: parseFloat(data[i][6]) || 0,
        remainingPrincipal: parseFloat(data[i][7]) || 0,
        status: data[i][8] || "未繳",
        transactionId: data[i][9] || ""
      });
    }
  }
  return list;
}

function updateLoanPeriodItem(item) {
  const sheet = getSheetByName("LoanSchedule");
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === item.id) {
      const row = i + 1;
      if (item.status) sheet.getRange(row, 9).setValue(item.status);
      if (item.monthlyPayment !== undefined) sheet.getRange(row, 5).setValue(item.monthlyPayment);
      if (item.principal !== undefined) sheet.getRange(row, 6).setValue(item.principal);
      if (item.interest !== undefined) sheet.getRange(row, 7).setValue(item.interest);
      return { success: true };
    }
  }
  return { success: false, message: "找不到該期攤還資料" };
}
