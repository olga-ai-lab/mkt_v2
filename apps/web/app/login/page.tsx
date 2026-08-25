import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="page login-page">
      <header className="page-head">
        <p className="eyebrow">Olga Marketing OS</p>
        <h1>Entre no seu workspace</h1>
        <p className="muted">Use a conta vinculada à sua organização.</p>
      </header>
      <LoginForm />
      <p className="login-help muted">
        Ainda não tem acesso? Peça ao responsável pela organização para adicionar sua conta.
      </p>
    </main>
  );
}
