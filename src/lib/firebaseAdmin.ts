import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!);

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

export const adminDb = getFirestore();
