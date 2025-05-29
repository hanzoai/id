import React from "react";
import * as Conf from "../Conf";
import GithubCorner from "react-github-corner";

class CustomGithubCorner extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      classes: props,
    };
  }

  render() {
    if (!Conf.ShowGithubCorner) {
      return null;
    }

    return (
      <GithubCorner href={"https://github.com/hanzoai/ai"} size={60} />
    );
  }
}

export default CustomGithubCorner;
