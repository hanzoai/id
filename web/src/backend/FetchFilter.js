import {Modal} from "antd";
import {ExclamationCircleFilled} from "@ant-design/icons";
import i18next from "i18next";
import * as Conf from "../Conf";
import * as Setting from "../Setting";

const {confirm} = Modal;
const {fetch: originalFetch} = window;

const demoModeCallback = (res) => {
  res.json().then(data => {
    if (Setting.isResponseDenied(data)) {
      confirm({
        title: i18next.t("general:This is a read-only demo site!"),
        icon: <ExclamationCircleFilled />,
        content: i18next.t("general:Go to writable demo site?"),
        okText: i18next.t("general:OK"),
        cancelText: i18next.t("general:Cancel"),
        onOk() {
          Setting.openLink(`https://demo.casdoor.com${location.pathname}${location.search}?username=built-in/admin&password=123`);
        },
        onCancel() {},
      });
    }
  });
};

const requestFilters = [];
const responseFilters = [];

if (Conf.IsDemoMode) {
  responseFilters.push(demoModeCallback);
}

window.fetch = async(url, option = {}) => {
  requestFilters.forEach(filter => filter(url, option));

  return new Promise((resolve, reject) => {
    originalFetch(url, option)
      .then(res => {
        if (!url.startsWith("/api/get-organizations")) {
          responseFilters.forEach(filter => filter(res.clone()));
        }
        resolve(res);
      })
      .catch(error => {
        reject(error);
      });
  });
};
