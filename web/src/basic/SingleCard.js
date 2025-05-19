import React from "react";
import {Card, Col} from "antd";
import * as Setting from "../Setting";
import {withRouter} from "react-router-dom";
import Meta from "antd/es/card/Meta";
class SingleCard extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      classes: props,
    };
  }

  wrappedAsSilentSigninLink(link) {
    if (link.startsWith("http")) {
      link += link.includes("?") ? "&silentSignin=1" : "?silentSignin=1";
    }
    return link;
  }

  renderCardMobile(logo, link, title, desc, time, isSingle) {
    const gridStyle = {
      width: "100vw",
      textAlign: "center",
      cursor: "pointer",
    };
    const silentSigninLink = this.wrappedAsSilentSigninLink(link);

    return (
      <Card.Grid style={gridStyle} onClick={() => Setting.goToLinkSoft(this, silentSigninLink)}>
        <img src={logo} alt="logo" width={"100%"} style={{marginBottom: "20px"}} />
        <Meta
          title={title}
          description={desc}
          style={{justifyContent: "center"}}
        />
      </Card.Grid>
    );
  }

  renderCard(logo, link, title, desc, time, isSingle) {
    const silentSigninLink = this.wrappedAsSilentSigninLink(link);

    return (
      <Col style={{paddingLeft: "20px", paddingRight: "20px", paddingBottom: "20px", marginBottom: "20px"}} span={6}>
        <Card
          hoverable
          cover={
            <img alt="logo" src={logo} style={{width: "100%", height: "200px", padding: "20px", objectFit: "scale-down"}} />
          }
          onClick={() => Setting.goToLinkSoft(this, silentSigninLink)}
          style={isSingle ? {width: "320px", height: "100%"} : {width: "100%", height: "100%"}}
        >
          <Meta title={title} description={desc} />
          <br />
          <br />
          <Meta title={""} description={Setting.getFormattedDateShort(time)} />
        </Card>
      </Col>
    );
  }

  render() {
    if (Setting.isMobile()) {
      return this.renderCardMobile(this.props.logo, this.props.link, this.props.title, this.props.desc, this.props.time, this.props.isSingle);
    } else {
      return this.renderCard(this.props.logo, this.props.link, this.props.title, this.props.desc, this.props.time, this.props.isSingle);
    }
  }
}

export default withRouter(SingleCard);
