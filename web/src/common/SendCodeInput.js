import {Button, Input} from "antd";
import React from "react";
import i18next from "i18next";
import * as UserBackend from "../backend/UserBackend";
import {SafetyOutlined} from "@ant-design/icons";
import {CaptchaModal} from "./modal/CaptchaModal";

const {Search} = Input;

export const SendCodeInput = ({value, disabled, textBefore, onChange, onButtonClickArgs, application, method, countryCode}) => {
  const [visible, setVisible] = React.useState(false);
  const [buttonLeftTime, setButtonLeftTime] = React.useState(0);
  const [buttonLoading, setButtonLoading] = React.useState(false);

  const handleCountDown = (leftTime = 60) => {
    let leftTimeSecond = leftTime;
    setButtonLeftTime(leftTimeSecond);
    const countDown = () => {
      leftTimeSecond--;
      setButtonLeftTime(leftTimeSecond);
      if (leftTimeSecond === 0) {
        return;
      }
      setTimeout(countDown, 1000);
    };
    setTimeout(countDown, 1000);
  };

  const handleOk = (captchaType, captchaToken, clintSecret) => {
    setVisible(false);
    setButtonLoading(true);
    UserBackend.sendCode(captchaType, captchaToken, clintSecret, method, countryCode, ...onButtonClickArgs).then(res => {
      setButtonLoading(false);
      if (res) {
        handleCountDown(60);
      }
    });
  };

  const handleCancel = () => {
    setVisible(false);
  };

  return (
    <React.Fragment>
      <Search
        addonBefore={textBefore}
        disabled={disabled}
        value={value}
        prefix={<SafetyOutlined />}
        placeholder={i18next.t("code:Enter your code")}
        onChange={e => onChange(e.target.value)}
        enterButton={
          <Button style={{fontSize: 14}} type={"primary"} disabled={disabled || buttonLeftTime > 0} loading={buttonLoading}>
            {buttonLeftTime > 0 ? `${buttonLeftTime} s` : buttonLoading ? i18next.t("code:Sending") : i18next.t("code:Send Code")}
          </Button>
        }
        onSearch={() => setVisible(true)}
        autoComplete="one-time-code"
      />
      <CaptchaModal
        owner={application.owner}
        name={application.name}
        visible={visible}
        onOk={handleOk}
        onCancel={handleCancel}
        isCurrentProvider={false}
      />
    </React.Fragment>
  );
};
