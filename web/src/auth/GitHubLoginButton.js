import {createButton} from "react-social-login-buttons";
import {StaticBaseUrl} from "../Setting";

function Icon({width = 24, height = 24, color}) {
  return <img src={`${StaticBaseUrl}/buttons/github.svg`} alt="Sign in with GitHub" />;
}

const config = {
  text: "Sign in with GitHub",
  icon: Icon,
  iconFormat: name => `fa fa-${name}`,
  style: {background: "#333333"},
  activeStyle: {background: "#393934"},
};

const GitHubLoginButton = createButton(config);

export default GitHubLoginButton;
