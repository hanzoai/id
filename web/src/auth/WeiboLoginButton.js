import {createButton} from "react-social-login-buttons";
import {StaticBaseUrl} from "../Setting";

function Icon({width = 24, height = 24, color}) {
  return <img src={`${StaticBaseUrl}/buttons/weibo.svg`} alt="Sign in with Weibo" />;
}

const config = {
  text: "Sign in with Weibo",
  icon: Icon,
  iconFormat: name => `fa fa-${name}`,
  style: {background: "#e62329"},
  activeStyle: {background: "#e54329"},
};

const WeiboLoginButton = createButton(config);

export default WeiboLoginButton;
