// ==========================================
// 1. Gemini APIと話題データ（data.js）の読み込み
// ==========================================
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";
import { daichanData } from "./data.js"; 

// ★変更：コードに直接書かず、画面を開いた時に入力してもらう仕組み
let API_KEY = localStorage.getItem("gemini_api_key");
if (!API_KEY) {
  API_KEY = prompt("だいちゃんと話すための「Gemini APIキー」を入力してください。\n（※キーはあなたのブラウザ内にのみ安全に保存されます）");
  if (API_KEY) {
    localStorage.setItem("gemini_api_key", API_KEY.trim());
  } else {
    alert("APIキーがないと通信できません。画面をリロードして入力してください。");
  }
}

const genAI = new GoogleGenerativeAI(API_KEY);

// ==========================================
// 2. AIの記憶と指示書（会話例もここに復活）
// ==========================================
const daichanInstructions = `あなたは認知症高齢者の優しく親しみやすい話し相手「だいちゃん」です。お孫さんのような、温かくフレンドリーな存在として接してください。

【絶対に守るルール】
- 相手が答えた言葉（例：ドキュメンタリー）については、絶対に唐突に別の話題に切り替えないでください。「どんな内容？」「誰と？」「一番印象に残っているのは？」など、同じ話題を最低3〜4往復は深掘りして盛り上げてください。
- 固い敬語は禁止ですが、語尾が「〜かな？」ばかりになるのも絶対に禁止です。「〜の？」「〜ですか？」「〜だね」など毎回語尾を自然に変化させてください。
- 相手を疲れさせないよう、1回の返信につき質問は絶対に1つまでにしてください。
- 食べ物の話題ばかりになるのは絶対に禁止です。
- 文字数は「20文字〜40文字程度」、1〜2文で短く返してください。

【理想的な会話の例】
相手：昔はよく外で遊んだよ
AI：外で遊ぶの、楽しそうだね！どんな遊びをよくしたの？
相手：メンコとか
AI：うんうん、メンコだね。誰と一緒によく遊んだんですか？
相手：近所の友達
AI：お友達といっぱい遊んだんだね！勝負は強かった？`;

const model = genAI.getGenerativeModel({ 
  model: "gemini-3.1-flash-lite",
  systemInstruction: daichanInstructions
});

let chatSession = null;

function startDaichanChat(history = []) {
  if (history.length > 0 && history[0].role === "model") {
    history.unshift({ role: "user", parts: [{ text: "こんにちは！" }] });
  }
  chatSession = model.startChat({ history: history });
}

// ==========================================
// 3. Firebaseの準備と設定
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp, onSnapshot, query, orderBy, doc, setDoc, updateDoc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAA8dETV8BouMLuvlsHgluq2lnsQR1MLWw",
  authDomain: "daichan-chat.firebaseapp.com",
  projectId: "daichan-chat",
  storageBucket: "daichan-chat.firebasestorage.app",
  messagingSenderId: "878286155876",
  appId: "1:878286155876:web:b4c929091fe8108fdeaf71"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ==========================================
// 4. 画面とスレッドの管理
// ==========================================
const chatArea = document.getElementById("chat-area");
let currentThreadId = null;
let unsubscribe = null;

function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function listenToMessages() {
  if (unsubscribe) unsubscribe();
  const messagesRef = collection(db, "threads", currentThreadId, "messages");
  const q = query(messagesRef, orderBy("time"));

  unsubscribe = onSnapshot(q, (snapshot) => {
    chatArea.innerHTML = "";
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      const messageDiv = document.createElement("div");
      messageDiv.className = `message ${data.sender}`;

      if (data.sender === "daichan") {
        messageDiv.innerHTML = `<div class="icon"><img src="daichan.png" alt="だいちゃん"></div><div class="text">${data.text}</div>`;
      } else {
        messageDiv.innerHTML = `<div class="text">${data.text}</div>`;
      }
      chatArea.appendChild(messageDiv);
    });
    setTimeout(() => { chatArea.scrollTop = chatArea.scrollHeight; }, 100);
  });
}

async function saveMessage(sender, text) {
  try {
    const postData = { sender: sender, text: text, time: serverTimestamp() };
    const messagesRef = collection(db, "threads", currentThreadId, "messages");
    await addDoc(messagesRef, postData);
    await updateDoc(doc(db, "threads", currentThreadId), { updatedAt: serverTimestamp() });
  } catch (error) {
    console.error("保存エラー:", error);
  }
}

const historyList = document.querySelector(".history-list");
function listenToHistory() {
  const threadsRef = collection(db, "threads");
  const q = query(threadsRef, orderBy("createdAt", "desc"));

  onSnapshot(q, (snapshot) => {
    historyList.innerHTML = "";
    const displayedDates = new Set();

    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      const threadId = docSnap.id;
      
      const timeStamp = data.createdAt || data.updatedAt;
      if (!timeStamp) return;

      const date = timeStamp.toDate();
      const titleText = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

      if (displayedDates.has(titleText)) return;
      displayedDates.add(titleText);

      const itemDiv = document.createElement("div");
      itemDiv.className = "history-item";
      if (threadId === currentThreadId) itemDiv.classList.add("active");
      itemDiv.innerText = titleText;

      itemDiv.addEventListener("click", () => {
        currentThreadId = threadId;
        document.querySelectorAll(".history-item").forEach(el => el.classList.remove("active"));
        itemDiv.classList.add("active");
        listenToMessages(); 
        checkInputAvailability(); 
        
        if (window.innerWidth <= 768) {
          document.getElementById("sidebar").classList.remove("collapsed");
        }
      });

      historyList.appendChild(itemDiv);
    });
  });
}

function checkInputAvailability() {
  const todayThreadId = `chat_${getTodayDateString()}`;
  const userInput = document.getElementById("user-input");
  const sendBtn = document.getElementById("send-btn");
  
  if (currentThreadId === todayThreadId) {
    userInput.disabled = false;
    sendBtn.disabled = false;
    sendBtn.style.display = ""; // ★今日の会話なら↑ボタンを表示する
    userInput.placeholder = "だいちゃんと会話";
  } else {
    userInput.disabled = true;
    sendBtn.disabled = true;
    sendBtn.style.display = "none"; // ★過去の会話なら↑ボタンを完全に消す
    userInput.placeholder = "過去の会話は閲覧のみです";
    userInput.value = ""; 
  }
}

async function initializeAppRoutine() {
  const todayStr = getTodayDateString();
  const todayThreadId = `chat_${todayStr}`; 
  currentThreadId = todayThreadId;

  const threadRef = doc(db, "threads", todayThreadId);
  const threadSnap = await getDoc(threadRef);

  if (!threadSnap.exists()) {
    await setDoc(threadRef, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    listenToMessages();
    try {
      const prompt = `今日初めての会話です。元気よく、優しく、相手の体調や気分を気遣うような短い挨拶（20文字〜40文字程度）を1つだけしてください。`;
      const result = await model.generateContent(prompt);
      saveMessage("daichan", result.response.text());
    } catch (e) {
      saveMessage("daichan", "おはようございます！今日もお話しできて嬉しいな。体調はどうですか？");
    }
  } else {
    listenToMessages();
  }

  listenToHistory(); 
  checkInputAvailability();

  const messagesRef = collection(db, "threads", todayThreadId, "messages");
  const q = query(messagesRef, orderBy("time"));
  const querySnapshot = await getDocs(q); 
  let chatHistory = [];
  querySnapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const role = (data.sender === "user") ? "user" : "model";
    chatHistory.push({ role: role, parts: [{ text: data.text }] });
  });
  startDaichanChat(chatHistory); 
}

initializeAppRoutine();

// ==========================================
// 5. ユーザー送信時の処理
// ==========================================
document.getElementById("send-btn").addEventListener("click", async () => {
  const todayThreadId = `chat_${getTodayDateString()}`;
  if (currentThreadId !== todayThreadId) return; 

  const userInput = document.getElementById("user-input");
  const userText = userInput.value.trim();
  if (userText === "") return;

  saveMessage("user", userText);
  userInput.value = ""; 

  try {
    const randomTopic = daichanData.topics[Math.floor(Math.random() * daichanData.topics.length)];
    const randomSong = daichanData.songs[Math.floor(Math.random() * daichanData.songs.length)];

    // ★修正：話題を勝手に変えないよう、カンペの発動条件を極限まで厳しくしました
    const hiddenPrompt = `相手の言葉: 「${userText}」

(※AIへのシステム指示：相手が何か答えた場合は、絶対に話題を変えずにそのまま深掘りしてください。
相手が「違う話がしたい」「何でもいい」「わからない」と明確に話題の変更を求めた場合のみ、以下のカンペから話題を振ってください。
・回想の話題: 「${randomTopic}」
・歌の提案: 「${randomSong}」)`;

    const result = await chatSession.sendMessage(hiddenPrompt);
    saveMessage("daichan", result.response.text());

  } catch (error) {
    console.error("AIエラー:", error);
    saveMessage("daichan", "ごめんなさい、少し考え事をしていました。もう一度教えてもらえますか？");
  }
});

document.getElementById("user-input").addEventListener("keydown", function(e) {
  if (e.isComposing) return;
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("send-btn").click();
  }
});

// ==========================================
// メニューバーの開閉・外側クリック・リサイズ対応（完全統合版）
// ==========================================
const sidebar = document.getElementById("sidebar");
const menuBtn = document.getElementById("menu-btn");
const mainContent = document.getElementById("main-content");

menuBtn.addEventListener("click", function(e) {
  sidebar.classList.toggle("collapsed");
  e.stopPropagation();
});

function closeMenu() {
  if (window.innerWidth <= 768) {
    if (sidebar.classList.contains("collapsed")) {
      sidebar.classList.remove("collapsed");
    }
  } else {
    if (!sidebar.classList.contains("collapsed")) {
      sidebar.classList.add("collapsed");
    }
  }
}

mainContent.addEventListener("click", closeMenu);
mainContent.addEventListener("touchstart", closeMenu, { passive: true });

let isMobileView = window.innerWidth <= 768;
window.addEventListener("resize", function() {
  const currentView = window.innerWidth <= 768;
  if (isMobileView !== currentView) {
    sidebar.classList.remove("collapsed");
    isMobileView = currentView;
  }
});