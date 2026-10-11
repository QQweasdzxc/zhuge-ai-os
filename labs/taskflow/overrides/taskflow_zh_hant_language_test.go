package handler

import "testing"

func TestTaskFlowSupportedLocaleReplacement(t *testing.T) {
	want := []string{"en", "zh-Hant", "zh-Hans", "ja", "fr"}
	if len(supportedLanguages) != len(want) {
		t.Fatalf("supported language count = %d, want %d", len(supportedLanguages), len(want))
	}
	for _, language := range want {
		if _, ok := supportedLanguages[language]; !ok {
			t.Errorf("supported language %q is missing", language)
		}
	}
	if _, ok := supportedLanguages["ko"]; ok {
		t.Fatal("Korean must not remain a supported account language")
	}
}
