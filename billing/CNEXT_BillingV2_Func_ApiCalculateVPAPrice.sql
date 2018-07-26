DELIMITER $$

USE `billingv2`$$

DROP FUNCTION IF EXISTS `Func_ApiCalculateVPAPrice`$$
DELIMITER $$

USE `billingv2`$$

DROP FUNCTION IF EXISTS `Func_ApiCalculateVPAPrice`$$

CREATE DEFINER=`root`@`localhost` FUNCTION `Func_ApiCalculateVPAPrice`(
	_resourceIdentifier VARCHAR(500),
	_listPrice DECIMAL(15,6),
	_costPrice DECIMAL(15,6),
	_vpaId CHAR(36)) RETURNS DECIMAL(15,6)
    DETERMINISTIC
BEGIN
	DECLARE _vpaPrice DECIMAL(15,6) ;
	DECLARE _isFloor TINYINT DEFAULT 0;
	DECLARE _region VARCHAR(100);
	DECLARE _producturi VARCHAR(500);
	DECLARE _decimalprecision CHAR(1);
	SET _vpaPrice= NULL;
	
	IF EXISTS(SELECT * FROM invoiceproperties  WHERE propertyname = 'decimalfloor')THEN
		SET _isFloor = 1;
	END IF;
	
	SET _decimalprecision = IFNULL((SELECT PropertyValue FROM invoiceproperties WHERE PropertyName = 'decimalprecision'),'2');
	
        SELECT IFNULL(
	(
		SELECT VR.Region FROM VpaRules VR
		WHERE VR.VpaId = _vpaId
			AND VR.provider  = SUBSTRING_INDEX(SUBSTRING_INDEX(_resourceIdentifier, '/', 2),'/',-1)
			AND (VR.Region = SUBSTRING_INDEX(SUBSTRING_INDEX(_resourceIdentifier, '/', 3),'/',-1) OR (VR.Region = 'all'))
			AND IFNULL(VR.basis,'NA') <> 'NA'
			LIMIT 1
	),'')
	INTO _region;
        
        
	IF EXISTS(
        SELECT VR.producturi FROM VpaRules VR
	WHERE VR.VpaId = _vpaId
		AND VR.provider  = SUBSTRING_INDEX(SUBSTRING_INDEX(_resourceIdentifier, '/', 2),'/',-1)
		AND (VR.Region = SUBSTRING_INDEX(SUBSTRING_INDEX(_resourceIdentifier, '/', 3),'/',-1) OR (VR.Region = ''))
		AND VR.producturi = _resourceIdentifier
		AND IFNULL(VR.basis,'NA') <> 'NA'
       )
        THEN
	BEGIN
	
	SELECT IFNULL((
	SELECT VR.producturi FROM VpaRules VR
	WHERE VR.VpaId = _vpaId
		AND VR.provider  = SUBSTRING_INDEX(SUBSTRING_INDEX(_resourceIdentifier, '/', 2),'/',-1)
		AND (VR.Region = SUBSTRING_INDEX(SUBSTRING_INDEX(_resourceIdentifier, '/', 3),'/',-1) OR (VR.Region = ''))
		AND VR.producturi = _resourceIdentifier
		AND IFNULL(VR.basis,'NA') <> 'NA'
	),'')
	INTO _producturi;
	
	
	SELECT IFNULL(
	(
		SELECT CASE IFNULL(VR.Basis,'')
			WHEN '' THEN _listPrice
			WHEN 'Cost Plus' THEN (1 + VR.percentage/100) * _costPrice
			WHEN 'Price Minus' THEN (1 - VR.percentage/100) * _listPrice END AS vpaPrice
		FROM VPARules VR
		WHERE VR.vpaId =_vpaId
			AND SUBSTRING_INDEX(SUBSTRING_INDEX(_resourceIdentifier, '/', 2),'/',-1) = VR.provider 
			AND IFNULL(VR.Region,'') = IFNULL(_region,'')
			AND IFNULL(VR.ProductUri,'') = IFNULL(_producturi,'') 
			AND VR.category <> 'all'
			AND IFNULL(VR.basis,'NA') <> 'NA'
	),_listPrice)
	INTO _vpaPrice;
	END;
 ELSE
 BEGIN
    
       SELECT IFNULL((
	SELECT VR.producturi FROM VpaRules VR
	WHERE VR.VpaId = _vpaId
		AND VR.provider  = SUBSTRING_INDEX(SUBSTRING_INDEX(_resourceIdentifier, '/', 2),'/',-1)
		AND (VR.Region = SUBSTRING_INDEX(SUBSTRING_INDEX(_resourceIdentifier, '/', 3),'/',-1) OR (VR.Region = 'all'))
		AND VR.producturi = _resourceIdentifier
		AND IFNULL(VR.basis,'NA') <> 'NA'
	),'')
	INTO _producturi;
      	SELECT IFNULL(
	(
		SELECT CASE IFNULL(VR.Basis,'')
			WHEN '' THEN _listPrice
			WHEN 'Cost Plus' THEN (1 + VR.percentage/100) * _costPrice
			WHEN 'Price Minus' THEN (1 - VR.percentage/100) * _listPrice END AS vpaPrice
		FROM VPARules VR
		WHERE VR.vpaId =_vpaId
			AND SUBSTRING_INDEX(SUBSTRING_INDEX(_resourceIdentifier, '/', 2),'/',-1) = VR.provider 
			AND IFNULL(VR.Region,'') = IFNULL(_region,'')
			AND IFNULL(VR.ProductUri,'') = IFNULL(_producturi,'') 
			AND VR.category <> 'all'
			AND IFNULL(VR.basis,'NA') <> 'NA'
	),_listPrice)
	INTO _vpaPrice;
	END;
	END IF;
	
	IF (_isFloor = 1)THEN
		SET _vpaPrice = FLOOR(_vpaPrice);
	ELSE
		SET _vpaPrice = ROUND(_vpaPrice, _decimalprecision);
	END IF;
RETURN IFNULL(_vpaPrice,'');
END$$

DELIMITER ;