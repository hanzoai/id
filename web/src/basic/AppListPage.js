import React from "react";
import * as ApplicationBackend from "../backend/ApplicationBackend";
import GridCards from "./GridCards";

const AppListPage = (props) => {
  const [applications, setApplications] = React.useState(null);

  React.useEffect(() => {
    if (props.account === null) {
      return;
    }
    ApplicationBackend.getApplicationsByOrganization("admin", props.account.owner)
      .then((res) => {
        setApplications(res.data || []);
      });
  }, [props.account]);

  const getItems = () => {
    if (applications === null) {
      return null;
    }

    return applications.map(application => {
      let homepageUrl = application.homepageUrl;
      if (homepageUrl === "<custom-url>") {
        homepageUrl = props.account.homepage;
      }

      return {
        link: homepageUrl,
        name: application.displayName,
        description: application.description,
        logo: application.logo,
        createdTime: "",
      };
    });

  };

  return (
    <div style={{display: "flex", justifyContent: "center", flexDirection: "column", alignItems: "center"}}>
      <GridCards items={getItems()} />
    </div>
  );
};

export default AppListPage;
