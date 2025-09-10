"use client";

import { auth, db } from "@/lib/firebase";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetEmail, setResetEmail] = useState("");

  useEffect(() => {
    // 动态加载 Firebase 模块
    import("firebase/app").then(({ initializeApp }) => {
      import("firebase/auth").then(
        ({
          getAuth,
          signInWithEmailAndPassword,
          createUserWithEmailAndPassword,
          signOut,
        }) => {
          import("firebase/firestore").then(({ getFirestore }) => {
            const firebaseConfig = {
              apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
              authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
              projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
              storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
              messagingSenderId:
                process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
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
                  const userCredential = await signInWithEmailAndPassword(
                    auth,
                    email,
                    password
                  );
                  const user = userCredential.user;
                  return {
                    success: true,
                    user,
                    userData: {
                      email: user.email,
                      uid: user.uid,
                      role: "user",
                    },
                  };
                } catch (error: any) {
                  if (error.code === "auth/user-not-found") {
                    const userCredential = await createUserWithEmailAndPassword(
                      auth,
                      email,
                      password
                    );
                    const user = userCredential.user;
                    return {
                      success: true,
                      user,
                      userData: {
                        email: user.email,
                        uid: user.uid,
                        role: "user",
                      },
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
              async sendPasswordReset(email: string) {
                try {
                  const { sendPasswordResetEmail } = await import(
                    "firebase/auth"
                  );
                  await sendPasswordResetEmail(auth, email);
                  return { success: true };
                } catch (error: any) {
                  return { success: false, error: error.message };
                }
              },
            };
          });
        }
      );
    });
  }, []);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = (document.getElementById("email") as HTMLInputElement).value;
    const password = (document.getElementById("password") as HTMLInputElement)
      .value;
    const loginBtn = document.getElementById("loginBtn") as HTMLButtonElement;
    const loading = document.getElementById("loading")!;
    const errorMessage = document.getElementById("errorMessage")!;

    loginBtn.disabled = true;
    loading.classList.add("show");
    errorMessage.textContent = "";

    try {
      if (!(window as any).FirebaseAPI)
        throw new Error("システム初期化中です。");

      const result = await (window as any).FirebaseAPI.loginUser(
        email,
        password
      );
      if (result.success) {
        errorMessage.innerHTML =
          "✅ ログイン成功！<br/> メインページに移動中...";
        errorMessage.setAttribute(
          "style",
          "color:#155724;background:#d4edda;border:1px solid #c3e6cb;padding:0.75rem;border-radius:6px;text-align:center;"
        );
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
          <input
            type="email"
            id="email"
            name="email"
            placeholder="your@email.com"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">パスワード</label>
          <input
            type="password"
            id="password"
            name="password"
            placeholder="パスワード"
            required
          />
        </div>

        <button type="submit" className="login-btn" id="loginBtn">
          ログイン
        </button>
        <div className="loading" id="loading">
          ログイン中...
        </div>
        <div className="error-message" id="errorMessage"></div>
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <button
            type="button"
            id="forgotLink"
            onClick={() => {
              const email = (
                document.getElementById("email") as HTMLInputElement
              ).value;
              const msgEl = document.getElementById(
                "resetMessage"
              ) as HTMLDivElement;
              msgEl.textContent = "";
              if (!email) {
                msgEl.textContent = "メールアドレスを入力してください。";
                msgEl.style.color = "#e74c3c";
                return;
              }
              setResetEmail(email);
              setShowResetConfirm(true);
            }}
            style={{
              background: "transparent",
              border: "none",
              color: "#6f8333",
              textDecoration: "underline",
              cursor: "pointer",
              fontSize: "0.95rem",
            }}
          >
            パスワードをお忘れですか？
          </button>
        </div>
        <div
          id="resetMessage"
          style={{ marginTop: 8, textAlign: "center", fontSize: "0.9rem" }}
        ></div>

        {/* 确认模态：在用户确认后才真正发送重置邮件 */}
        {showResetConfirm && (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.35)",
              zIndex: 2000,
            }}
            onClick={() => setShowResetConfirm(false)}
          >
            <div
              role="document"
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 380,
                maxWidth: "94%",
                background: "#fff",
                borderRadius: 10,
                padding: 20,
                boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
                textAlign: "center",
              }}
            >
              <div style={{ marginBottom: 8, fontSize: 16, color: "#222" }}>
                パスワードリセットのメールを送信してもよろしいですか？
              </div>
              <div style={{ marginBottom: 12, color: "#555", fontSize: 14 }}>
                送信先: <strong>{resetEmail}</strong>
              </div>
              <div
                style={{ display: "flex", gap: 12, justifyContent: "center" }}
              >
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid #ccc",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const msgEl = document.getElementById(
                      "resetMessage"
                    ) as HTMLDivElement;
                    msgEl.textContent = "送信中...";
                    msgEl.style.color = "#6f8333";
                    setShowResetConfirm(false);
                    if (!(window as any).FirebaseAPI) {
                      msgEl.textContent =
                        "システム初期化中です。しばらくお待ちください。";
                      msgEl.style.color = "#e67e22";
                      return;
                    }
                    const res = await (
                      window as any
                    ).FirebaseAPI.sendPasswordReset(resetEmail);
                    if (res.success) {
                      msgEl.textContent =
                        "パスワードリセットのメールを送信しました。受信トレイを確認してください。";
                      msgEl.style.color = "#155724";
                    } else {
                      msgEl.textContent = res.error || "送信に失敗しました。";
                      msgEl.style.color = "#e74c3c";
                    }
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "none",
                    background: "#6f8333",
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  送信する
                </button>
              </div>
            </div>
          </div>
        )}
      </form>

      {/* 内联样式 */}
      <style jsx>{`
        body {
          font-family: "Segoe UI", "Arial", sans-serif;
          background: #f8faef;
        }
        .login-container {
          background: white;
          padding: 3rem;
          border-radius: 16px;
          max-width: 400px;
          margin: auto;
          box-shadow: 0 8px 32px rgba(111, 131, 51, 0.1);
        }
        .logo {
          text-align: center;
          margin-bottom: 2.5rem;
        }
        .logo-icon {
          width: 64px;
          height: 64px;
          background: linear-gradient(135deg, #6f8333 0%, #8fa446 100%);
          border-radius: 12px;
          margin: 0 auto 1rem;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 2rem;
        }
        .logo-icon::before {
          content: "🤖";
          color: white;
          font-size: 32px;
        }
        .form-group {
          margin-bottom: 1.5rem;
        }
        label {
          display: block;
          margin-bottom: 0.5rem;
          color: #6f8333;
          font-weight: 500;
          font-size: 0.9rem;
        }
        input {
          width: 100%;
          padding: 0.875rem;
          border: 2px solid #e8eae0;
          border-radius: 8px;
          font-size: 1rem;
          background: #fafbf7;
          color: #6f8333;
        }
        .login-btn {
          width: 100%;
          padding: 1rem;
          background: linear-gradient(135deg, #6f8333 0%, #8fa446 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
        }
        .loading {
          display: none;
          text-align: center;
          margin-top: 1rem;
        }
        .loading.show {
          display: block;
        }
        .error-message {
          color: #e74c3c;
          margin-top: 1rem;
          text-align: center;
          font-size: 0.9rem;
        }
      `}</style>
    </div>
  );
}
