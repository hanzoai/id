package controllers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

type cloudResp struct {
	User struct {
		Organizations []struct {
			Role string `json:"role"`
			Plan string `json:"plan"`
		} `json:"organizations"`
	} `json:"user"`
}

func (c *ApiController) GetOrganizationCloud(email string) string {
	type organization struct {
		Role string `json:"role"`
		Plan string `json:"plan"`
	}
	type userData struct {
		Organizations []organization `json:"organizations"`
	}
	type cloudResponse struct {
		User userData `json:"user"`
	}

	var cloudResp cloudResponse

	reqUrl := fmt.Sprintf("https://cloud.hanzo.ai/api/public/organization?email=%s", url.QueryEscape(email))
	httpResp, err := http.Get(reqUrl)

	if err != nil {
		c.ResponseError("Failed to fetch cloud organization info: " + err.Error())
		return ""
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode != http.StatusOK {
		// c.ResponseError(fmt.Sprintf("Cloud API responded with %d", httpResp.StatusCode))
		return ""
	}

	if err := json.NewDecoder(httpResp.Body).Decode(&cloudResp); err != nil {
		c.ResponseError("Failed to decode cloud response: " + err.Error())
		return ""
	}

	highestRank := map[string]int{
		"cloud:free": 0,
		"cloud:dev":  1,
		"cloud:pro":  2,
		"cloud:team": 3,
	}

	var (
		highestPlan  string = "cloud:free"
		highestScore int    = 0
	)

	for _, org := range cloudResp.User.Organizations {
		role := strings.ToLower(org.Role)
		plan := strings.ToLower(org.Plan)
		if role == "owner" || role == "admin" {
			if rank, ok := highestRank[plan]; ok && rank > highestScore {
				highestScore = rank
				highestPlan = org.Plan // giữ nguyên case gốc
			}
		}
	}

	return highestPlan
}
