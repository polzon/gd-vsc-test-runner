extends GdUnitTestSuite

const Calculator := preload("res://src/calculator.gd")


func test_describe_positive() -> void:
	assert_str(Calculator.new().describe(1)).is_equal("positive")


func test_rank_zero() -> void:
	assert_str(Calculator.new().rank(0)).is_equal("zero")


func test_rank_positive(
	value: int,
	_test_parameters := [[1], [2], [3]],
) -> void:
	assert_bool(Calculator.new().rank(value) != "zero").is_true()
