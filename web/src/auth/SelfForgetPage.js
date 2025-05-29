import React from "react";
import {authConfig} from "./Auth";
import ForgetPage from "./ForgetPage";

class SelfForgetPage extends React.Component {
  render() {
    return (
      <ForgetPage
        type={"forgotPassword"}
        applicationName={authConfig.appName}
        {...this.props}
      />
    );
  }
}

export default SelfForgetPage;
