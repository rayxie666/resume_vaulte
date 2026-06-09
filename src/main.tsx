import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DialogProvider } from "./Dialogs";
import { LocaleProvider } from "./i18n";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LocaleProvider>
      <DialogProvider>
        <App />
      </DialogProvider>
    </LocaleProvider>
  </React.StrictMode>,
);
