import * as Setting from "../Setting";
import i18next from "i18next";

export function sendTestSms(provider, phone) {
  testSmsProvider(provider, phone)
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

function testSmsProvider(provider, phone = "") {
  const SmsForm = {
    content: "123456",
    receivers: [phone],
    owner: provider.owner,
    name: provider.name,
  };

  return fetch(`${Setting.ServerUrl}/api/send-sms?provider=` + provider.name, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(SmsForm),
  }).then(res => res.json());
}
