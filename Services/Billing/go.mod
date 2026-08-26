module github.com/zbxing/goexample/Services/Billing

go 1.25.0

toolchain go1.25.13

require (
	github.com/zbxing/goexample/Framework v0.0.0
	github.com/zbxing/goexample/SDK/Billing v0.0.0
)

replace github.com/zbxing/goexample/Framework => ../../Framework

replace github.com/zbxing/goexample/SDK/Billing => ../../SDK/Billing
