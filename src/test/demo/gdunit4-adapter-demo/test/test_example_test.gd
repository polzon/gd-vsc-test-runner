extends GdUnitTestSuite


func test_success():
	assert_bool(true).is_true()


func test_failure():
	(
		assert_bool(false)
		. append_failure_message("This is supposed to fail.")
		. is_true()
	)
