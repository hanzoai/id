import {Card, Row, Spin} from "antd";
import i18next from "i18next";
import React from "react";
import * as Setting from "../Setting";
import SingleCard from "./SingleCard";

const GridCards = (props) => {
  const items = props.items;

  if (items === null || items === undefined) {
    return (
      <div style={{display: "flex", justifyContent: "center", alignItems: "center", marginTop: "10%"}}>
        <Spin size="large" tip={i18next.t("login:Loading")} style={{paddingTop: "10%"}} />
      </div>
    );
  }

  return (
    Setting.isMobile() ? (
      <Card styles={{body: {padding: 0}}}>
        {items.map(item => <SingleCard key={item.link} logo={item.logo} link={item.link} title={item.name} desc={item.description} isSingle={items.length === 1} />)}
      </Card>
    ) : (
      <div style={{width: "100%", padding: "0 100px"}}>
        <Row style={{justifyContent: "center"}}>
          {items.map(item => <SingleCard logo={item.logo} link={item.link} title={item.name} desc={item.description} time={item.createdTime} isSingle={items.length === 1} key={item.name} />)}
        </Row>
      </div>
    )
  );
};

export default GridCards;
