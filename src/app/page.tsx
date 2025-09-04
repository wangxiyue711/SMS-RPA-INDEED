"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/login"); // 跳转到你写的登录页
  }, []);

  return null; // 或显示一段文字：return <p>ログインページへ移動中...</p>;
}
