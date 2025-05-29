import {Button} from "antd";
import React from "react";
import i18next from "i18next";
import {CaptchaModal} from "./modal/CaptchaModal";
import * as UserBackend from "../backend/UserBackend";

export const CaptchaPreview = (props) => {
  const {owner, name, provider, captchaType, subType, clientId, clientSecret, clientId2, clientSecret2, providerUrl} = props;
  const [visible, setVisible] = React.useState(false);

  const clickPreview = () => {
    provider.name = name;
    provider.clientId = clientId;
    provider.type = captchaType;
    provider.providerUrl = providerUrl;
    if (clientSecret !== "***") {
      provider.clientSecret = clientSecret;
      setVisible(true);
    } else {
      setVisible(true);
    }
  };

  const isButtonDisabled = () => {
    if (captchaType !== "Default") {
      if (!clientId || !clientSecret) {
        return true;
      }
      if (captchaType === "Aliyun Captcha") {
        if (!subType || !clientId2 || !clientSecret2) {
          return true;
        }
      }
    }
    return false;
  };

  const onOk = (captchaType, captchaToken, clientSecret) => {
    UserBackend.verifyCaptcha(owner, name, captchaType, captchaToken, clientSecret).then(() => {
      setVisible(false);
    });
  };

  const onCancel = () => {
    setVisible(false);
  };

  return (
    <React.Fragment>
      <Button
        style={{fontSize: 14}}
        type={"primary"}
        onClick={clickPreview}
        disabled={isButtonDisabled()}
      >
        {i18next.t("general:Preview")}
      </Button>
      <CaptchaModal
        owner={owner}
        name={name}
        visible={visible}
        onOk={onOk}
        onCancel={onCancel}
        isCurrentProvider={true}
      />
    </React.Fragment>
  );
};
