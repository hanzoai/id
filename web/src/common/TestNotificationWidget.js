import * as Setting from "../Setting";
import i18next from "i18next";

export function sendTestNotification(provider) {
  testNotificationProvider(provider)
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

function testNotificationProvider(provider) {
  const notificationForm = {
    content: provider.content,
    owner: provider.owner,
    name: provider.name,
  };

  return fetch(`${Setting.ServerUrl}/api/send-notification?provider=${provider.name}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(notificationForm),
  }).then(res => res.json());
}
