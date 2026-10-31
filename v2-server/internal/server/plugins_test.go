package server_test

import "testing"

func TestPluginMarketHTTP(t *testing.T) {
	f := newSquadServer(t)
	c := newContractClient(t, f.srv.URL)
	c.login()
	tenant := c.tenant()
	status, body := c.do("GET", "/api/v1/tenants/"+tenant+"/spaces", nil)
	if status != 200 {
		t.Fatalf("spaces = %d %v", status, body)
	}
	spaces, _ := body["items"].([]any)
	if len(spaces) != 1 {
		t.Fatalf("spaces = %v", body)
	}
	space := spaces[0].(map[string]any)["id"].(string)
	base := "/api/v1/tenants/" + tenant + "/spaces/" + space + "/plugins"

	status, body = c.do("GET", base+"/catalog", nil)
	if status != 200 {
		t.Fatalf("catalog = %d %v", status, body)
	}
	catalog, _ := body["items"].([]any)
	if len(catalog) < 8 || body["syncedAt"] == nil {
		t.Fatalf("catalog = %v", body)
	}

	status, body = c.do("GET", base, nil)
	if status != 200 {
		t.Fatalf("plugins = %d %v", status, body)
	}
	if items, _ := body["items"].([]any); len(items) != 2 {
		t.Fatalf("initial plugins = %v", body)
	}

	input := map[string]any{
		"identifier":    "demo/writing-kit",
		"pluginVersion": "1.2.0",
		"version":       0,
	}
	status, body = c.doHeaders("POST", base, input, map[string]string{
		"Idempotency-Key": "install-writing-kit",
	})
	if status != 200 {
		t.Fatalf("install = %d %v", status, body)
	}
	resource := body["resource"].(map[string]any)
	if resource["kind"] != "skill" || resource["observedState"] != "installed" ||
		resource["observedVersion"] != "1.2.0" {
		t.Fatalf("installed = %v", resource)
	}
	version := resource["version"].(float64)

	// Replaying the same key and body returns the original resource without another version bump.
	status, replay := c.doHeaders("POST", base, input, map[string]string{
		"Idempotency-Key": "install-writing-kit",
	})
	if status != 200 {
		t.Fatalf("replay = %d %v", status, replay)
	}
	if replayed := replay["resource"].(map[string]any); replayed["version"] != version {
		t.Fatalf("replayed = %v, want version %v", replayed, version)
	}
	status, body = c.doHeaders("POST", base, map[string]any{
		"identifier": "demo/review-kit",
		"version":    0,
	}, map[string]string{"Idempotency-Key": "install-writing-kit"})
	if status != 409 || body["code"] != "idempotency_conflict" {
		t.Fatalf("key reuse = %d %v", status, body)
	}

	status, body = c.doHeaders("POST", base, map[string]any{
		"identifier": "demo/starter-pack",
		"version":    0,
	}, map[string]string{"Idempotency-Key": "install-pack"})
	if status != 400 || body["code"] != "plugin_kind_not_installable" {
		t.Fatalf("pack = %d %v", status, body)
	}

	status, body = c.doHeaders("DELETE", base, map[string]any{
		"identifier": "demo/writing-kit",
	}, map[string]string{"Idempotency-Key": "remove-without-version"})
	if status != 428 || body["code"] != "version_required" {
		t.Fatalf("missing version = %d %v", status, body)
	}
	status, body = c.doHeaders("DELETE", base, map[string]any{
		"identifier": "demo/writing-kit",
		"version":    int64(version),
	}, map[string]string{"Idempotency-Key": "remove-writing-kit"})
	if status != 200 {
		t.Fatalf("remove = %d %v", status, body)
	}
	removed := body["resource"].(map[string]any)
	if removed["desiredState"] != "removed" || removed["observedState"] != "removed" ||
		removed["observedVersion"] != nil {
		t.Fatalf("removed = %v", removed)
	}

	status, body = c.do("GET", base, nil)
	if status != 200 {
		t.Fatalf("plugins after remove = %d %v", status, body)
	}
	if items, _ := body["items"].([]any); len(items) != 3 {
		t.Fatalf("plugins after remove = %v", body)
	}
}
