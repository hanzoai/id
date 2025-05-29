import {createButton} from "react-social-login-buttons";
import {StaticBaseUrl} from "../Setting";

function Icon({width = 24, height = 24, color}) {
  return <img src={`${StaticBaseUrl}/buttons/gitee.svg`} alt="Sign in with Gitee" />;
}

const config = {
  text: "Sign in with Gitee",
  icon: Icon,
  iconFormat: name => `fa fa-${name}`,
  style: {background: "rgb(199,29,35)"},
  activeStyle: {background: "rgb(147,22,26)"},
};

const GiteeLoginButton = createButton(config);

export default GiteeLoginButton;
