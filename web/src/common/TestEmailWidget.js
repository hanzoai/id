import * as Setting from "../Setting";
import i18next from "i18next";

export function sendTestEmail(provider, email) {
  testEmailProvider(provider, email)
    .then((res) => {
      if (res.status === "ok") {
        Setting.showMessage("success", i18next.t("general:Successfully sent"));
      } else {
        Setting.showMessage("error", res.msg);
      }
    })
    .catch(error => {
      Setting.showMessage("error", `${i18next.t("general:Failed to connect to server")}: ${error}`);
    });
}

export function connectSmtpServer(provider) {
  testEmailProvider(provider)
    .then((res) => {
      if (res.status === "ok") {
        Setting.showMessage("success", i18next.t("provider:SMTP connected successfully"));
      } else {
        Setting.showMessage("error", res.msg);
      }
    })
    .catch(error => {
      Setting.showMessage("error", `${i18next.t("general:Failed to connect to server")}: ${error}`);
    });
}

function testEmailProvider(provider, email = "") {
  const emailForm = {
    title: provider.title,
    content: provider.content,
    sender: provider.displayName,
    receivers: email === "" ? ["TestSmtpServer"] : [email],
    provider: provider.name,
    providerObject: provider,
    owner: provider.owner,
    name: provider.name,
  };

  return fetch(`${Setting.ServerUrl}/api/send-email`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(emailForm),
  }).then(res => res.json());
}
