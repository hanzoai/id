import {createButton} from "react-social-login-buttons";
import {StaticBaseUrl} from "../Setting";

function Icon({width = 24, height = 24, color}) {
  return <img src={`${StaticBaseUrl}/buttons/wechat.svg`} alt="Sign in with Wechat" />;
}

const config = {
  text: "Sign in with Wechat",
  icon: Icon,
  iconFormat: name => `fa fa-${name}`,
  style: {background: "rgb(0,194,80)"},
  activeStyle: {background: "rgb(0,158,64)"},
};

const WechatLoginButton = createButton(config);

export default WechatLoginButton;
