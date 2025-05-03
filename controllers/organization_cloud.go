package controllers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/casdoor/casdoor/object"
)

type cloudResp struct {
	User struct {
		Organizations []struct {
			Role string `json:"role"`
			Plan string `json:"plan"`
			Name string `json:"name"`
		} `json:"organizations"`
	} `json:"user"`
}

func (c *ApiController) GetOrganizationCloud(email string) []object.OrganizationPlan {
	var cloudResp cloudResp

	reqUrl := fmt.Sprintf("https://cloud.hanzo.ai/api/public/organization?email=%s", url.QueryEscape(email))
	httpResp, err := http.Get(reqUrl)
	if err != nil {
		c.ResponseError("Failed to fetch cloud organization info: " + err.Error())
		return nil
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode != http.StatusOK {
		// c.ResponseError(fmt.Sprintf("Cloud API responded with %d", httpResp.StatusCode))
		return nil
	}

	if err := json.NewDecoder(httpResp.Body).Decode(&cloudResp); err != nil {
		c.ResponseError("Failed to decode cloud response: " + err.Error())
		return nil
	}

	var result []object.OrganizationPlan

	fmt.Printf("=>>>> Check Cloud Org :>>> %v", cloudResp.User.Organizations)

	for _, org := range cloudResp.User.Organizations {
		role := strings.ToLower(org.Role)
		if role == "owner" || role == "admin" {
			result = append(result, object.OrganizationPlan{
				Original: org.Name,
				Plan:     strings.ToLower(org.Plan),
			})
		}
	}

	return result
}
