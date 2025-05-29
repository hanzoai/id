import React from "react";
import {Table} from "antd";
import i18next from "i18next";

class PrometheusInfoTable extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      table: props.table,
    };
  }
  render() {
    const latencyColumns = [
      {
        title: i18next.t("general:Name"),
        dataIndex: "name",
        key: "name",
      },
      {
        title: i18next.t("general:Method"),
        dataIndex: "method",
        key: "method",
      },
      {
        title: i18next.t("system:Count"),
        dataIndex: "count",
        key: "count",
      },
      {
        title: i18next.t("system:Latency") + "(ms)",
        dataIndex: "latency",
        key: "latency",
      },
    ];
    const throughputColumns = [
      {
        title: i18next.t("general:Name"),
        dataIndex: "name",
        key: "name",
      },
      {
        title: i18next.t("general:Method"),
        dataIndex: "method",
        key: "method",
      },
      {
        title: i18next.t("system:Throughput"),
        dataIndex: "throughput",
        key: "throughput",
      },
    ];
    if (this.state.table === "latency") {
      return (
        <div style={{height: "300px", overflow: "auto"}}>
          <Table columns={latencyColumns} dataSource={this.props.prometheusInfo.apiLatency} pagination={false} />
        </div>
      );
    } else if (this.state.table === "throughput") {
      return (
        <div style={{height: "300px", overflow: "auto"}}>
          {i18next.t("system:Total Throughput")}: {this.props.prometheusInfo.totalThroughput}
          <Table columns={throughputColumns} dataSource={this.props.prometheusInfo.apiThroughput} pagination={false} />
        </div>
      );
    }
  }
}

export default PrometheusInfoTable;
