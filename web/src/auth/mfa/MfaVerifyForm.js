import {Form} from "antd";
import i18next from "i18next";
import * as MfaBackend from "../../backend/MfaBackend";
import * as Setting from "../../Setting";
import React from "react";
import {EmailMfaType, SmsMfaType, TotpMfaType} from "../MfaSetupPage";
import MfaVerifySmsForm from "./MfaVerifySmsForm";
import MfaVerifyTotpForm from "./MfaVerifyTotpForm";

export const mfaAuth = "mfaAuth";
export const mfaSetup = "mfaSetup";

export function MfaVerifyForm({mfaProps, application, user, onSuccess, onFail}) {
  const [form] = Form.useForm();
  const onFinish = ({passcode, countryCode, dest}) => {
    const data = {passcode, mfaType: mfaProps.mfaType, secret: mfaProps.secret, dest: dest, countryCode: countryCode, ...user};
    MfaBackend.MfaSetupVerify(data)
      .then((res) => {
        if (res.status === "ok") {
          res.dest = dest;
          res.countryCode = countryCode;
          onSuccess(res);
        } else {
          onFail(res);
        }
      })
      .catch((error) => {
        Setting.showMessage("error", `${i18next.t("general:Failed to connect to server")}: ${error}`);
      })
      .finally(() => {
        form.setFieldsValue({passcode: ""});
      });
  };

  if (mfaProps === undefined || mfaProps === null || application === undefined || application === null || user === undefined || user === null) {
    return <div></div>;
  }

  if (mfaProps.mfaType === SmsMfaType || mfaProps.mfaType === EmailMfaType) {
    return <MfaVerifySmsForm mfaProps={mfaProps} onFinish={onFinish} application={application} method={mfaSetup} user={user} />;
  } else if (mfaProps.mfaType === TotpMfaType) {
    return <MfaVerifyTotpForm mfaProps={mfaProps} onFinish={onFinish} />;
  } else {
    return <div></div>;
  }
}
