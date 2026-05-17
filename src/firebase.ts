// src/firebase.ts
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Firebase 콘솔 웹 설정에서 복사한 내용을 여기에 붙여넣으세요!
const firebaseConfig = {
  apiKey: "AIzaSyBCi44dm3XNtUHK5ezgSLqktUwUUsYeyys",
  authDomain: "colab-board-50c00.firebaseapp.com",
  databaseURL: "https://colab-board-50c00-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "colab-board-50c00",
  storageBucket: "colab-board-50c00.firebasestorage.app",
  messagingSenderId: "425758524537",
  appId: "1:425758524537:web:e36f0bddd18043798d40a8"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);

// 실시간 데이터베이스 도구(db)를 다른 파일에서도 쓸 수 있게 내보냅니다.
export const db = getDatabase(app);