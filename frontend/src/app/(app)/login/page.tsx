import { redirect } from "next/navigation";

/** The spec calls the onboarding page /login. Connect wallet and role choice live on /app. */
export default function Login() {
  redirect("/app");
}
