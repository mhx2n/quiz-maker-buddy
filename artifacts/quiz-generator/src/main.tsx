import { createRoot } from "react-dom/client";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";
import { installErrorReporting } from "./lib/error-reporting";
import { API_BASE } from "./lib/api-base";
import { getToken } from "./lib/auth-api";

// Point the generated API hooks at the backend and attach the auth token.
setBaseUrl(API_BASE || null);
setAuthTokenGetter(() => getToken());

installErrorReporting();

createRoot(document.getElementById("root")!).render(<App />);
