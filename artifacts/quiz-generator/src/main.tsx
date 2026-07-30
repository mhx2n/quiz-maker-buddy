import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installErrorReporting } from "./lib/error-reporting";

installErrorReporting();

createRoot(document.getElementById("root")!).render(<App />);
