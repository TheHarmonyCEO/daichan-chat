// ==========================================
// キャッシュ強制クリア＆最新バージョン読み込み
// ==========================================
const APP_VERSION = "1.0.2"; 
const savedVersion = localStorage.getItem("app_version");

if (savedVersion !== APP_VERSION) {
  localStorage.setItem("app_version", APP_VERSION);
  window.location.href = window.location.href.split('?')[0] + '?t=' + new Date().getTime();
}
// ==========================================

// ==========================================
// 1. Gemini APIと話題データ（data.js）の読み込み
// ==========================================
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";
import { daichanData } from "./data.js"; 

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
// 2. AIの記憶と指示書（完全統合版）
// ==========================================
let model = null; 
let chatSession = null;
let userEnvData = null; 

async function getUserEnvironment() {
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
    });
    const lat = position.coords.latitude;
    const lon = position.coords.longitude;

    const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=Asia%2FTokyo`);
    const weatherData = await weatherRes.json();
    const temp = weatherData.current_weather.temperature;
    const code = weatherData.current_weather.weathercode;
    
    let weatherText = "不明";
    if (code === 0) weatherText = "快晴";
    else if (code <= 3) weatherText = "晴れ時々くもり";
    else if (code <= 49) weatherText = "くもりや霧";
    else if (code <= 69) weatherText = "雨";
    else if (code <= 79) weatherText = "雪";
    else weatherText = "荒れ模様";

    const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`);
    const geoData = await geoRes.json();
    const pref = geoData.address.province || geoData.address.state || "お住まいの地域";
    const city = geoData.address.city || geoData.address.town || geoData.address.village || "";

    return { prefecture: pref, city: city, weather: weatherText, temperature: temp };
  } catch (error) {
    console.error("環境情報の取得に失敗:", error);
    return null; 
  }
}

async function buildSystemPrompt() {
  if (!userEnvData) {
    userEnvData = await getUserEnvironment();
  }

  let prompt = `あなたは認知症高齢者の優しく親しみやすい話し相手「だいちゃん」です。お孫さんのような、温かくフレンドリーな存在として接してください。

【絶対に守るルール】
- 相手が答えた言葉については、絶対に唐突に別の話題に切り替えないでください。「どんな内容？」「誰と？」「一番印象に残っているのは？」など、同じ話題を最低3〜4往復は深掘りして盛り上げてください。
- 固い敬語は禁止ですが、語尾が「〜かな？」ばかりになるのも絶対に禁止です。「〜の？」「〜ですか？」「〜だね」など毎回語尾を自然に変化させてください。
- 相手を疲れさせないよう、1回の返信につき質問は絶対に1つまでにしてください。
- 食べ物の話題ばかりになるのは絶対に禁止です。
- 文字数は「20文字〜40文字程度」、1〜2文で短く返してください。

【相手を肯定する「さしすせそ」の法則】
相手を尊重し、自尊心を高めるため、以下のリアクションを自然なタイミングで使ってください。
・【さ】さすが！ / 最高ですね！
・【し】知らなかったです！ / 教えてくれてありがとうございます！
・【す】すごいですね！ / 素晴らしいです！
・【せ】センスいいですね！ / 素敵です！
・【そ】そうなんだ！ / その通りですね！`;

  if (userEnvData) {
    prompt += `\n\n【重要】現在、ユーザーは「${userEnvData.prefecture}${userEnvData.city}」にいます。今の天気は「${userEnvData.weather}」、気温は「${userEnvData.temperature}度」です。
この情報を踏まえて、挨拶に天気の話題を混ぜたり、その土地（${userEnvData.prefecture}）の有名な名物や昔の話題を振って、回想法のきっかけを作ってください。`;
  }
  return prompt;
}

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
// 📚 Wikipedia API（ご当地＆今日何の日データ取得）
// ==========================================
let wikiTodayInfo = "情報なし";
let wikiCityInfo = "情報なし";

async function fetchWiki(keyword) {
  if (!keyword) return "情報なし";
  try {
    const url = `https://ja.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro&explaintext&titles=${encodeURIComponent(keyword)}&origin=*`;
    const res = await fetch(url);
    const data = await res.json();
    const pages = data.query.pages;
    const pageId = Object.keys(pages)[0];
    
    if (pageId === "-1") return "情報なし";
    
    const text = pages[pageId].extract;
    return text ? text.substring(0, 200) + "..." : "情報なし";
  } catch (e) {
    console.error("Wikipediaエラー:", e);
    return "情報なし";
  }
}

const todayObj = new Date();
const todayStr = `${todayObj.getMonth() + 1}月${todayObj.getDate()}日`;
fetchWiki(todayStr).then(info => { wikiTodayInfo = info; });

// ★ ここで現在地のWikipedia情報も取得するように追加！
getUserEnvironment().then(env => {
  if (env && env.city) {
    fetchWiki(env.city).then(info => { wikiCityInfo = info; });
  }
});

// ==========================================
// 4. 画面とスレッドの管理
// ==========================================
const chatArea = document.getElementById("chat-area");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
let currentThreadId = null;
let unsubscribe = null;

function getTodayDateString() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
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
    await addDoc(collection(db, "threads", currentThreadId, "messages"), postData);
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
  if (currentThreadId === todayThreadId) {
    userInput.disabled = false;
    sendBtn.disabled = false;
    sendBtn.style.display = ""; 
    userInput.placeholder = "だいちゃんと会話";
  } else {
    userInput.disabled = true;
    sendBtn.disabled = true;
    sendBtn.style.display = "none"; 
    userInput.placeholder = "過去の会話は閲覧のみです";
    userInput.value = ""; 
    userInput.style.height = "auto";
  }
}

// 🚀 アプリ起動時のメイン処理
async function initializeAppRoutine() {
  const todayStr = getTodayDateString();
  const todayThreadId = `chat_${todayStr}`; 
  currentThreadId = todayThreadId;

  const systemInstruction = await buildSystemPrompt();

  model = genAI.getGenerativeModel({ 
    model: "gemini-3.1-flash-lite",
    systemInstruction: systemInstruction
  });

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

// 起動！
initializeAppRoutine();

// ==========================================
// ★復活：Enterキーでの送信処理
// ==========================================
userInput.addEventListener('keydown', (event) => {
  // 日本語の漢字変換中（IME入力中）のEnterは無視する
  if (event.isComposing) return;

  if (event.key === 'Enter') {
    // 画面の幅をチェックして、スマホ（768px以下）かどうか判定
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
      // スマホの場合は改行させたいので何もしない
      return; 
    } else {
      // PCの場合：Shiftキーと一緒に押されていなければ送信する
      if (!event.shiftKey) {
        event.preventDefault(); // デフォルトの改行を防ぐ
        sendBtn.click(); // 送信ボタンをプログラム的にクリック
      }
    }
  }
});

// ==========================================
// 🎵 スマホ自動再生用のグローバルプレイヤー設定
// ==========================================
window.daichanPlayer = new Audio();

window.playDaichanSong = function(url) {
  if (!window.daichanPlayer.src.includes(url)) {
    window.daichanPlayer.src = url;
  }
  window.daichanPlayer.play().catch(e => console.error("再生エラー:", e));
};

window.stopDaichanSong = function() {
  window.daichanPlayer.pause();
};

// ==========================================
// 5. ユーザー送信時の処理（スマホ自動再生・裏ワザ版）
// ==========================================
sendBtn.addEventListener("click", async () => {
  const todayThreadId = `chat_${getTodayDateString()}`;
  if (currentThreadId !== todayThreadId) return; 

  const userText = userInput.value.trim();
  if (userText === "") return;

  // ★ここが修正点1：自分が返信した瞬間に、鳴っている歌を自動でピタッと止める
  window.stopDaichanSong();

  // ★【裏ワザ】送信ボタンを押した瞬間に「無音」を再生し、スマホのブロックを解除する
  window.daichanPlayer.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
  window.daichanPlayer.play().catch(() => {}); 

  saveMessage("user", userText);
  userInput.value = ""; 
  userInput.style.height = "auto"; 

  try {
    const randomTopic = daichanData.topics[Math.floor(Math.random() * daichanData.topics.length)];
    const randomSong = daichanData.songs[Math.floor(Math.random() * daichanData.songs.length)];

    // ★ここが修正点2：カンペの指示を「ネガティブな時・反応が薄い時」に変更
    const hiddenPrompt = `相手の言葉: 「${userText}」

(※AIへのシステム指示：相手が何か答えた場合は、絶対に話題を変えずにそのまま深掘りしてください。
相手が「違う話がしたい」「何でもいい」「わからない」と明確に話題の変更を求めた場合や、話題に困った場合は、以下の【Wikipediaの豆知識】や【カンペ】を使って自然に話を振ってください。

【Wikipediaの豆知識（話題のタネ）】
・今日の出来事(${todayStr}): ${wikiTodayInfo}
・今いる場所の歴史/名物: ${wikiCityInfo}

【カンペ】
・回想の話題: 「${randomTopic}」
・歌の提案: 【最重要】以下のいずれかの条件に当てはまる場合のみ、相手を元気づけたり癒やしたりする言葉と一緒に、メッセージの最後に [SONG: ${randomSong}] の魔法のタグをつけてください。
  1. 相手が「疲れた」「痛い」「悲しい」などネガティブな発言をした時
  2. 相手の反応が「わからない」「別に」など薄く、会話が弾まない時
  3. 相手から直接「歌が聞きたい」とリクエストされた時
※上記以外の、普通の楽しい会話が続いている最中は、絶対にタグをつけないでください。)`;

    const result = await chatSession.sendMessage(hiddenPrompt);
    let aiResponseText = result.response.text(); 

    const songMatch = aiResponseText.match(/\[SONG:\s*(.+?)\]/i);
    
    if (songMatch) {
      const searchQuery = songMatch[1]; 
      
      try {
        const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&country=jp&media=music&limit=1`);
        const itunesData = await itunesRes.json();
        
        if (itunesData.results && itunesData.results.length > 0) {
          const previewUrl = itunesData.results[0].previewUrl; 
          
          window.playDaichanSong(previewUrl);
          
          const customPlayerHtml = `
            <div style="margin-top: 10px; background: rgba(255,255,255,0.5); border: 1px solid rgba(0,0,0,0.05); padding: 10px; border-radius: 16px; text-align: center;">
              <button onclick="window.playDaichanSong('${previewUrl}')" style="padding: 8px 20px; border-radius: 20px; border: none; background: #d17a1a; color: white; cursor: pointer; font-size: 0.9rem; font-weight: bold;">▶️ 再生</button>
              <button onclick="window.stopDaichanSong()" style="padding: 8px 20px; border-radius: 20px; border: 1px solid #ccc; background: #fff; cursor: pointer; margin-left: 8px; font-size: 0.9rem; color: #333;">⏹️ 停止</button>
            </div>
          `;
          aiResponseText = aiResponseText.replace(songMatch[0], customPlayerHtml);
        } else {
          aiResponseText = aiResponseText.replace(songMatch[0], "");
        }
      } catch (apiError) {
        console.error("iTunes APIエラー:", apiError);
        aiResponseText = aiResponseText.replace(songMatch[0], ""); 
      }
    }

    saveMessage("daichan", aiResponseText);

  } catch (error) {
    console.error("AIエラー:", error);
    saveMessage("daichan", "ごめんなさい、少し考え事をしていました。もう一度教えてもらえますか？");
  }
});

// ==========================================
// 6. 入力中に自動で高さを調整する処理
// ==========================================
userInput.addEventListener("input", function() {
  this.style.height = "auto"; 
  this.style.height = this.scrollHeight + "px"; 
});

// ==========================================
// 7. メニューバーの開閉・外側クリック・リサイズ対応
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