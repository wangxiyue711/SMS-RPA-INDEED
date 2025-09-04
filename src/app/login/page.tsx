"use client";

import { auth, db } from "@/lib/firebase";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    // 动态加载 Firebase 模块
    import("firebase/app").then(({ initializeApp }) => {
      import("firebase/auth").then(({ getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut }) => {
        import("firebase/firestore").then(({ getFirestore }) => {
          const firebaseConfig = {
            apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
            authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
            storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
            messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
            appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
            measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
          };

          const app = initializeApp(firebaseConfig);
          const auth = getAuth(app);
          const db = getFirestore(app);

          // 挂到 window 上（和你原来一样）
          (window as any).auth = auth;
          (window as any).db = db;

          (window as any).FirebaseAPI = {
            async loginUser(email: string, password: string) {
              try {
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                return {
                  success: true,
                  user,
                  userData: { email: user.email, uid: user.uid, role: "user" },
                };
              } catch (error: any) {
                if (error.code === "auth/user-not-found") {
                  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                  const user = userCredential.user;
                  return {
                    success: true,
                    user,
                    userData: { email: user.email, uid: user.uid, role: "user" },
                  };
                }
                return { success: false, error: error.message };
              }
            },
            async logoutUser() {
              try {
                await signOut(auth);
                return { success: true };
              } catch (error: any) {
                return { success: false, error: error.message };
              }
            },
          };
        });
      });
    });
  }, []);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = (document.getElementById("email") as HTMLInputElement).value;
    const password = (document.getElementById("password") as HTMLInputElement).value;
    const loginBtn = document.getElementById("loginBtn") as HTMLButtonElement;
    const loading = document.getElementById("loading")!;
    const errorMessage = document.getElementById("errorMessage")!;

    loginBtn.disabled = true;
    loading.classList.add("show");
    errorMessage.textContent = "";

    try {
      if (!(window as any).FirebaseAPI) throw new Error("システム初期化中です。");

      const result = await (window as any).FirebaseAPI.loginUser(email, password);
      if (result.success) {
        errorMessage.textContent = "✅ ログイン成功！メインページに移動中...";
        errorMessage.setAttribute("style", "color:#155724;background:#d4edda;border:1px solid #c3e6cb;padding:0.75rem;border-radius:6px;text-align:center;");
        setTimeout(() => router.push("/main"), 1500);
      } else {
        errorMessage.textContent = result.error || "ログインに失敗しました";
      }
    } catch (error: any) {
      errorMessage.textContent = "エラー: " + error.message;
    } finally {
      loginBtn.disabled = false;
      loading.classList.remove("show");
    }
  }

  return (
    <div className="login-container">
      <div className="logo">
        <div className="logo-icon"></div>
        <h1>SMS PUBLISHER</h1>
      </div>

      <form id="loginForm" onSubmit={handleLogin}>
        <div className="form-group">
          <label htmlFor="email">メールアドレス</label>
          <input type="email" id="email" name="email" placeholder="your@email.com" required />
        </div>

        <div className="form-group">
          <label htmlFor="password">パスワード</label>
          <input type="password" id="password" name="password" placeholder="パスワード" required />
        </div>

        <button type="submit" className="login-btn" id="loginBtn">ログイン</button>
        <div className="loading" id="loading">ログイン中...</div>
        <div className="error-message" id="errorMessage"></div>
      </form>

      {/* 内联样式 */}
      <style jsx>{`
        body { font-family: "Segoe UI", "Arial", sans-serif; background: #f8faef; }
        .login-container { background: white; padding: 3rem; border-radius: 16px; max-width: 400px; margin: auto; box-shadow: 0 8px 32px rgba(111,131,51,0.1); }
        .logo { text-align: center; margin-bottom: 2.5rem; }
        .logo-icon { width:64px;height:64px;background:linear-gradient(135deg,#6f8333 0%,#8fa446 100%);border-radius:12px;margin:0 auto 1rem;display:flex;align-items:center;justify-content:center;font-size:2rem; }
        .logo-icon::before { content:"🤖"; color:white; font-size:32px; }
        .form-group { margin-bottom:1.5rem; }
        label { display:block; margin-bottom:0.5rem; color:#6f8333; font-weight:500; font-size:0.9rem; }
        input { width:100%; padding:0.875rem; border:2px solid #e8eae0; border-radius:8px; font-size:1rem; background:#fafbf7; color:#6f8333; }
        .login-btn { width:100%; padding:1rem; background:linear-gradient(135deg,#6f8333 0%,#8fa446 100%); color:white; border:none; border-radius:8px; font-size:1rem; font-weight:600; cursor:pointer; }
        .loading { display:none; text-align:center; margin-top:1rem; }
        .loading.show { display:block; }
        .error-message { color:#e74c3c; margin-top:1rem; text-align:center; font-size:0.9rem; }
      `}</style>
    </div>
  );
}
