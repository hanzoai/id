import {createButton} from "react-social-login-buttons";
import {StaticBaseUrl} from "../Setting";

function Icon({width = 24, height = 24, color}) {
  return <img src={`${StaticBaseUrl}/buttons/douyin.svg`} alt="Sign in with Douyin" style={{width: 24, height: 24}} />;
}

const config = {
  text: "Sign in with Douyin",
  icon: Icon,
  iconFormat: name => `fa fa-${name}`,
  style: {background: "#ffffff", color: "#000000"},
  activeStyle: {background: "#ededee"},
};

const DouyinLoginButton = createButton(config);

export default DouyinLoginButton;
