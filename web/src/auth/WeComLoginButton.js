import {createButton} from "react-social-login-buttons";
import {StaticBaseUrl} from "../Setting";

function Icon({width = 24, height = 24, color}) {
  return <img src={`${StaticBaseUrl}/buttons/wecom.svg`} alt="Sign in with WeCom" />;
}

const config = {
  text: "Sign in with WeCom",
  icon: Icon,
  iconFormat: name => `fa fa-${name}`,
  style: {background: "rgb(255,255,255)", color: "#000000"},
  activeStyle: {background: "rgb(100,150,250)"},
};

const WeComLoginButton = createButton(config);

export default WeComLoginButton;
