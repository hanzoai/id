import "core-js/es";
import "react-app-polyfill/ie9";
import "react-app-polyfill/stable";
import React from "react";
import {createRoot} from "react-dom/client";
import "./index.css";
import "./App.less";
import App from "./App";
import * as serviceWorker from "./serviceWorker";
import {BrowserRouter} from "react-router-dom";
import "./backend/FetchFilter";

if (!String.prototype.replaceAll) {
  String.prototype.replaceAll = function(search, replace) {
    return this.split(search).join(replace);
  };
}

const container = document.getElementById("root");

const app = createRoot(container);

app.render(<BrowserRouter>
  <App />
</BrowserRouter>);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
