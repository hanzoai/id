import {Button, Popconfirm} from "antd";
import i18next from "i18next";
import React from "react";

export const PopconfirmModal = (props) => {
  const text = props.text ? props.text : i18next.t("general:Delete");
  const size = props.size ? props.size : "middle";
  return (
    <Popconfirm
      title={props.title}
      onConfirm={props.onConfirm}
      disabled={props.disabled}
      okText={i18next.t("general:OK")}
      cancelText={i18next.t("general:Cancel")}
    >
      <Button style={{...props.style}} size={size} disabled={props.disabled} type="primary" danger>{text}</Button>
    </Popconfirm>
  );
};

export default PopconfirmModal;
