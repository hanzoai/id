import React from "react";
import LoginPage from "./LoginPage";
import {authConfig} from "./Auth";

class SelfLoginPage extends React.Component {
  constructor(props) {
    super(props);
    import("../ManagementPage");
  }
  render() {
    return (
      <LoginPage type={"login"} mode={"signin"} applicationName={authConfig.appName} {...this.props} />
    );
  }
}

export default SelfLoginPage;
