// 1. Firebaseの準備（必要な機能をインポート）
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

// 2. Firebaseの設定
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

// 3. メッセージを送信してFirestoreに保存する処理
function sendMessage() {
  const textInput = document.getElementById("user-input");
  const text = textInput.value.trim(); // 余白を削除

  if (text === "") return; // 空文字の場合は送信しない

  const postData = {
    sender: "user", // 誰が送ったか（ユーザーなら'user'、だいちゃんなら'daichan'）
    text: text,
    time: serverTimestamp(),
  };

  // Firestoreの "daichan_chat" というコレクション（本棚）に保存
  addDoc(collection(db, "daichan_chat"), postData);

  // 送信後に入力欄を空にする
  textInput.value = "";
}

// 送信ボタンがクリックされた時の処理
document.getElementById("send-btn").addEventListener("click", sendMessage);

// Enterキーが押された時の処理
document.getElementById("user-input").addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    sendMessage();
  }
});

// 4. Firestoreのデータを受信して画面に表示する処理（リアルタイム同期）
const q = query(collection(db, "daichan_chat"), orderBy("time", "asc"));

onSnapshot(q, (snapshot) => {
  const chatArea = document.getElementById("chat-area");
  chatArea.innerHTML = ""; // 一度画面を空にして、古い重複表示を防ぐ

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    
    // 【修正箇所】 if (data.time) の条件を削除しました！
    
    // メッセージの外枠（divタグ）を作る
    const messageDiv = document.createElement("div");
    // senderの値をクラス名にセット
    messageDiv.className = `message ${data.sender}`; 

    // 吹き出し（divタグ）を作る
    const bubbleDiv = document.createElement("div");
    bubbleDiv.className = "bubble";
    bubbleDiv.textContent = data.text;

    // 外枠の中に吹き出しを入れ、画面に追加する
    messageDiv.appendChild(bubbleDiv);
    chatArea.appendChild(messageDiv);
  });

  // メッセージが増えたら、自動で一番下（最新）までスクロールする
  chatArea.scrollTop = chatArea.scrollHeight;
});