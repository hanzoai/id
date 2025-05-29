import React from "react";
import {Tooltip} from "antd";
import {QuestionCircleOutlined} from "@ant-design/icons";
import * as TourConfig from "../TourConfig";
import * as Setting from "../Setting";

class OpenTour extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      isTourVisible: props.isTourVisible ?? TourConfig.getTourVisible(),
    };
  }

  canTour = () => {
    const path = window.location.pathname.replace("/", "");
    return TourConfig.TourUrlList.indexOf(path) !== -1 || path === "";
  };

  render() {
    return (
      this.canTour() ?
        <Tooltip title="Click to open tour">
          <div className="select-box" style={{display: Setting.isMobile() ? "none" : null, ...this.props.style}} onClick={() => TourConfig.setIsTourVisible(true)} >
            <QuestionCircleOutlined style={{fontSize: "24px"}} />
          </div>
        </Tooltip>
        :
        <div className="select-box" style={{display: Setting.isMobile() ? "none" : null, cursor: "not-allowed", ...this.props.style}} >
          <QuestionCircleOutlined style={{fontSize: "24px", color: "#adadad"}} />
        </div>
    );
  }
}

export default OpenTour;
