extends GdUnitTestSuite

const Calculator := preload("res://src/calculator.gd")


func test_describe_positive() -> void:
	assert_str(Calculator.new().describe(1)).is_equal("positive")


func test_rank_zero() -> void:
	assert_str(Calculator.new().rank(0)).is_equal("zero")
